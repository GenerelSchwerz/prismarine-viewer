const EventEmitter = require('events')
const { WorldView } = require('../viewer')

module.exports = (bot, { viewDistance = 6, firstPerson = false, port = 3000, prefix = '' }) => {
  const express = require('express')

  const app = express()
  const http = require('http').createServer(app)

  const io = require('socket.io')(http, { path: prefix + '/socket.io' })

  const { setupRoutes } = require('./common')
  setupRoutes(app, prefix)

  const sockets = []
  const primitives = {}

  bot.viewer = new EventEmitter()

  bot.viewer.erase = (id) => {
    delete primitives[id]
    for (const socket of sockets) {
      socket.emit('primitive', { id })
    }
  }

  bot.viewer.drawBoxGrid = (id, start, end, color = 'aqua') => {
    primitives[id] = { type: 'boxgrid', id, start, end, color }
    for (const socket of sockets) {
      socket.emit('primitive', primitives[id])
    }
  }

  bot.viewer.drawLine = (id, points, color = 0xff0000) => {
    primitives[id] = { type: 'line', id, points, color }
    for (const socket of sockets) {
      socket.emit('primitive', primitives[id])
    }
  }

  bot.viewer.drawPoints = (id, points, color = 0xff0000, size = 5) => {
    primitives[id] = { type: 'points', id, points, color, size }
    for (const socket of sockets) {
      socket.emit('primitive', primitives[id])
    }
  }

  let renderInterval = null

  let maxFPS = 0
  let maxFPSId = null

  const fpsMap = new Map()

  io.on('connection', (socket) => {
    const getRenderInterval = (fps) => setInterval(() => bot.viewer.emit('onRender', fps), 1000 / fps)

    const updateListener = ({ id, fps }) => {
      if (id == null || fps == null) return

      fpsMap.set(id, fps)

      if (fps > maxFPS) {
        maxFPS = fps
        if (renderInterval) clearInterval(renderInterval)

        renderInterval = getRenderInterval(maxFPS)
      } else if (id === maxFPSId && fps < maxFPS) {
        // handle where maxFPSId's fps decreases

        let secondHighest = 0
        let secondHighestId = null

        // check for alternative highest fps
        for (const [id1, fps1] of fpsMap) {
          if (fps1 > secondHighest && id1 !== id) {
            secondHighest = fps1
            secondHighestId = id1
          }
        }

        // if there is no alternative highest fps, set maxFPS to current fps
        // note: if secondHighest is 0, then there is no alternative highest fps
        if (fps > secondHighest) {
          maxFPS = fps
          maxFPSId = id
          if (renderInterval) clearInterval(renderInterval)

          renderInterval = getRenderInterval(maxFPS)
        } else {
          // if there is an alternative highest fps that is higher than current FPS,
          // set maxFPS to the alternative highest fps
          maxFPS = secondHighest
          maxFPSId = secondHighestId
          if (renderInterval) clearInterval(renderInterval)

          renderInterval = getRenderInterval(maxFPS)
        }
      }
    }

    const onSocketRemoval = () => {
      if (fpsMap.has(socket.id)) {
        fpsMap.delete(socket.id)
      }

      if (fpsMap.size === 0) {
        maxFPS = 0
        if (renderInterval) clearInterval(renderInterval)
        return
      }

      for (const [, fps] of fpsMap) {
        if (fps > maxFPS) {
          maxFPS = fps
        }
      }

      if (renderInterval) clearInterval(renderInterval)

      renderInterval = getRenderInterval(maxFPS)
    }

    socket.on('renderFPS', updateListener)
    socket.emit('version', bot.version)
    sockets.push(socket)

    const worldView = new WorldView(bot.world, viewDistance, bot.entity.position, socket)
    worldView.init(bot.entity.position)

    worldView.on('blockClicked', (block, face, button) => {
      bot.viewer.emit('blockClicked', block, face, button)
    })

    for (const id in primitives) {
      socket.emit('primitive', primitives[id])
    }

    function botPosition () {
      const packet = { pos: bot.entity.position, yaw: bot.entity.yaw, addMesh: true }
      if (firstPerson) {
        packet.pitch = bot.entity.pitch
      }
      socket.emit('position', packet)
      worldView.updatePosition(bot.entity.position)
    }

    bot.on('move', botPosition)
    worldView.listenToBot(bot)
    socket.on('disconnect', () => {
      bot.removeListener('move', botPosition)
      worldView.removeListenersFromBot(bot)
      sockets.splice(sockets.indexOf(socket), 1)
      onSocketRemoval()
    })
  })

  http.listen(port, () => {
    console.log(`Prismarine viewer web server running on *:${port}`)
  })

  bot.viewer.close = () => {
    http.close()
    for (const socket of sockets) {
      socket.disconnect()
    }

    // should already always be handled, but hey you never know.
    if (renderInterval) clearInterval(renderInterval)
    fpsMap.clear()
  }
}
