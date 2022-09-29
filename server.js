import express from 'express'
import http from 'http'
import https from 'https'
import fs from 'fs-extra'
import path from 'path'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { getLength, getDist, getDirection, dot, project, norm, mult, add, sub } from './vector.js'
import { collide } from './collision.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const config = fs.readJSONSync('config.json')
console.log(config)

const app = express()
const staticPath = path.join(__dirname, 'public')
const staticMiddleware = express.static(staticPath)
app.use(staticMiddleware)
const clientHtmlPath = path.join(__dirname, 'public', 'client.html')
app.get('/', function (req, res) { res.sendFile(clientHtmlPath) })
const socketIoPath = path.join(__dirname, 'node_modules', 'socket.io', 'client-dist')
app.get('/socketIo/:fileName', function (req, res) {
  const filePath = path.join(socketIoPath, req.params.fileName)
  res.sendFile(filePath)
})

function makeServer () {
  if (config.secure) {
    const key = fs.readFileSync('./sis-key.pem')
    const cert = fs.readFileSync('./sis-cert.pem')
    const credentials = { key, cert }
    return new https.Server(credentials, app)
  } else {
    return new http.Server(app)
  }
}

const server = makeServer()
const io = new Server(server)
io.path(staticPath)
server.listen(config.port, () => {
  console.log(`Listening on :${config.port}`)
  setInterval(tick, dt * 1000)
})

function range (n) { return [...Array(n).keys()] }

const dt = 0.01
const actorMovePower = 60
const drag = 0.5
const actorSize = 1
const nodeSize = 9
const nodeSpread = 10

const compass = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: Math.sqrt(0.5), y: Math.sqrt(0.5) },
  { x: -Math.sqrt(0.5), y: Math.sqrt(0.5) },
  { x: Math.sqrt(0.5), y: -Math.sqrt(0.5) },
  { x: -Math.sqrt(0.5), y: -Math.sqrt(0.5) }
]

const state = {
  time: 0,
  players: [],
  nodes: [],
  walls: [],
  attackers: [],
  wallPadding: 5,
  wallThickness: 50000,
  mapSize: 150,
  xMax: Infinity,
  yMax: Infinity,
  xMin: -Infinity,
  yMin: -Infinity
}
const players = new Map()
const attackers = new Map()
const sockets = new Map()
const units = new Map()

setupWalls()
setupNodes()

function tick () {
  state.time += dt
  movePlayers()
  moveAttackers()
  collide(state)
  grow()
  updateClients()
  pursue()
}

function pursue () {
  state.attackers.forEach(attacker => {
    const min = { distance: Infinity }
    players.forEach(player => {
      const distance = getDist(attacker.position, player.position)
      if (distance < min.distance) {
        attacker.prey = player
        min.distance = distance
      }
    })
    const prey = attacker.prey
    if (prey) {
      const preyDir = getDirection(attacker.position, prey.position)
      const projection = project(prey.velocity, preyDir)
      const rejection = sub(prey.velocity, projection)
      const flee = 1 * (dot(norm(projection), preyDir) > 0)
      const fleeVelocity = add(rejection, mult(projection, flee))
      const distance = getDist(attacker.position, prey.position)
      const advance = 4 + 0.5 * distance
      const targetVelocity = add(fleeVelocity, mult(preyDir, advance))
      const pursueForce = norm(sub(targetVelocity, attacker.velocity))
      const targetForce = add(pursueForce, mult(prey.force, flee))
      const best = { align: 0 }
      compass.forEach(compassDir => {
        const align = dot(compassDir, targetForce)
        if (align > best.align) {
          best.align = align
          attacker.force = norm(compassDir)
        }
      })
    }
  })
}

function grow () {
  players.forEach(player => {
    player.buildTimer += dt / 5
  })
  attackers.forEach(attacker => {
    attacker.freezeTimer += dt / 2
  })
}

function movePlayers () {
  state.players.forEach(player => {
    if (player.controls) {
      const dx = player.controls.right - player.controls.left
      const dy = player.controls.down - player.controls.up
      player.force = norm({ x: dx, y: dy })
      moveActor(player)
    }
  })
}

function moveAttackers () {
  state.attackers.forEach(attacker => {
    if (attacker.freezeTimer > 1) {
      moveActor(attacker)
    }
  })
}

function moveActor (actor) {
  actor.velocity.x -= actor.velocity.x * drag * dt
  actor.velocity.y -= actor.velocity.y * drag * dt
  actor.velocity.x += actor.force.x * actorMovePower * dt
  actor.velocity.y += actor.force.y * actorMovePower * dt
  actor.position.x += actor.velocity.x * dt
  actor.position.y += actor.velocity.y * dt
}

function setupWalls () {
  const wallLength = state.mapSize + state.wallPadding + state.wallThickness
  state.xMax = state.mapSize + state.wallPadding
  state.yMax = state.mapSize + state.wallPadding
  state.xMin = -state.mapSize - state.wallPadding
  state.yMin = -state.mapSize - state.wallPadding
  const topWall = {
    position: { x: 0, y: -0.5 * wallLength },
    width: wallLength + state.wallThickness,
    height: state.wallThickness,
    id: state.walls.length,
    role: 'wall'
  }
  state.walls.push(topWall)
  const bottomWall = {
    position: { x: 0, y: 0.5 * wallLength },
    width: wallLength + state.wallThickness,
    height: state.wallThickness,
    id: state.walls.length,
    role: 'wall'
  }
  state.walls.push(bottomWall)
  const leftWall = {
    position: { x: -0.5 * wallLength, y: 0 },
    width: state.wallThickness,
    height: wallLength + state.wallThickness,
    id: state.walls.length,
    role: 'wall'
  }
  state.walls.push(leftWall)
  const rightWall = {
    position: { x: 0.5 * wallLength, y: 0 },
    width: state.wallThickness,
    height: wallLength + 0.5 * state.wallThickness,
    id: state.walls.length,
    role: 'wall'
  }
  state.walls.push(rightWall)
}

function setupNodes () {
  range(100000).forEach(i => {
    const position = {
      x: (Math.random() - 0.5) * (state.mapSize - 2 * nodeSize),
      y: (Math.random() - 0.5) * (state.mapSize - 2 * nodeSize)
    }
    const nodeDistances = state.nodes.map(node => getDist(position, node.position))
    const minNodeDist = Math.min(...nodeDistances, Infinity)
    const edgeDistances = nodeDistances.map(dist => Math.abs(dist - 2 * nodeSize))
    const minEdgeDist = Math.min(...edgeDistances)
    const centerDist = getLength(position)
    if (minNodeDist > 1.3 * nodeSpread && minEdgeDist > 0.2 * nodeSpread && centerDist > nodeSpread) {
      const node = {
        position,
        id: state.nodes.length,
        size: nodeSize,
        radius: nodeSize,
        range: nodeSize,
        fill: 1,
        income: 0,
        team: 0,
        role: 'node',
        neighborIds: []
      }
      state.nodes.push(node)
    }
  })
  range(state.nodes.length).forEach(i => {
    range(state.nodes.length).forEach(j => {
      if (i < j) {
        const a = state.nodes[i]
        const b = state.nodes[j]
        const dist = getDist(a.position, b.position)
        if (dist < 2 * nodeSize) {
          a.neighborIds.push(b.id)
          b.neighborIds.push(a.id)
        }
      }
    })
  })
}

async function updateClients () {
  state.players = Array.from(players.values())
  state.attackers = Array.from(attackers.values())
  state.units = Array.from(units.values())
  players.forEach(player => {
    const socket = sockets.get(player.id)
    const msg = { state, position: player.position }
    socket.emit('updateClient', msg)
  })
}

io.on('connection', socket => {
  console.log('connection:', socket.id)
  socket.emit('socketId', socket.id)
  state.players = Array.from(players.values())
  const teamCount1 = state.players.filter(player => player.team === 1).length
  const teamCount2 = state.players.filter(player => player.team === 2).length
  const smallTeam = teamCount1 > teamCount2 ? 2 : 1
  const player = {
    id: socket.id,
    team: smallTeam,
    buildTimer: 0,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    force: { x: 0, y: 0 },
    radius: actorSize,
    role: 'player'
  }
  players.set(socket.id, player)
  sockets.set(socket.id, socket)
  const attacker = {
    id: socket.id,
    team: 3,
    position: { x: 0, y: 1 },
    velocity: { x: 0, y: 0 },
    force: { x: 0, y: 0 },
    prey: null,
    radius: actorSize,
    freezeTimer: 0,
    role: 'attacker'
  }
  attackers.set(socket.id, attacker)
  socket.on('updateServer', message => {
    player.controls = message.controls
  })
  socket.on('disconnect', () => {
    console.log('disconnect:', socket.id)
    sockets.delete(socket.id)
    players.delete(socket.id)
    attackers.delete(socket.id)
  })
})
