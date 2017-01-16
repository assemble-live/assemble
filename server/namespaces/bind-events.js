const redis = require('../redis')
const queueAttn = require('../attenuation-workers')
const colors = require('./user-colors')
const {print} = require('../utils')
const debug = require('debug')

let colorIdx = 0

const transformId = raw =>
  raw.split('#')[1]

const ignore = _ => _
const panic = err => {
  throw print(err)
}

module.exports = (io, nsp, name) => {
  const room = redis.room(name)
  const pings = {}
  const log = debug('assemble:' + name)
  let updateIntervalId = null

  nsp.on('connection', socket => {
    socket.on('me', user => {
      const uid = transformId(socket.id)

      room.users
        .add(uid, Object.assign(user, {
          id: uid,
          color: colors[colorIdx % colors.length]
        }))
        .then(room.users.getAll)
        .then(allUsers => {
          if (allUsers.length > 0 && !updateIntervalId)
            updateIntervalId = setInterval(nsp.update, 50)

          nsp.emit('users', allUsers)
          nsp.emit('dimensions', {
            x: 400 * allUsers.length,
            y: 300 * allUsers.length
          })

          room.locations.set(uid, {
            x: 200 * allUsers.length,
            y: 150 * allUsers.length
          })
          .then(ignore)
          .catch(panic)
        })
        .catch(panic)

      colorIdx++
      pings[transformId(socket.id)] = 50
    })

    socket.on('location', loc => {
      room.locations
        .set(transformId(socket.id), loc)
        .then(ignore)
        .catch(panic)

      queueAttn({room: name, uid: transformId(socket.id)})
    })

    socket.on('volume', vol =>
      room.volumes
        .set(transformId(socket.id), vol)
        .then(ignore)
        .catch(panic)
    )

    socket.on('signal', config => {
      const sid = `/${name}#${config.to}`

      if (nsp.connected[sid]) {
        nsp
          .connected[sid]
          .emit(`signal-from-${transformId(socket.id)}`, config)
      }
    })

    socket.on('disconnect', () => {
      pings[transformId(socket.id)] = undefined
      delete pings[transformId(socket.id)]

      room.users
        .remove(transformId(socket.id))
        .then(_ =>
          room.users
            .getAll()
            .then(allUsers => {
              nsp.emit('users', allUsers)

              if (allUsers.length == 0) {
                nsp.implode()
                clearInterval(updateIntervalId)
              }

              nsp.emit('dimensions', {
                x: 400 * allUsers.length,
                y: 300 * allUsers.length
              })
            })
            .catch(panic)
        )
        .catch(panic)
    })
  })

  nsp.implode = () => {
    Object.keys(nsp.connected).forEach(id => nsp[id].disconnect())
    nsp.removeAllListeners()
    delete io.nsps[name]
  }

  nsp.update = () => {
    for (let sid in nsp.connected) {
      const uid = transformId(sid)

      room.updates.for(uid)
      .then(update => {
        /* Could not be connected if stuff has changed since 5 lines ago */
        if (nsp.connected[sid])
          nsp.connected[sid].emit('update', update)
      })
      .catch(panic)
    }
  }

  return nsp
}