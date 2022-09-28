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
const drag = 1
const actorMovePower = 70
const mapSize = 150
const actorSize = 1.5
const nodeSize = 9
const nodeSpread = 6

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
  predators: []
}
const players = new Map()
const predators = new Map()
const sockets = new Map()
const units = new Map()

// setupWalls()
setupNodes()

function tick () {
  state.time += dt
  movePlayers()
  movePredators()
  collide(state)
  grow()
  updateClients()
  pursue()
}

const predator = {
  id: 0,
  team: 3,
  position: { x: 0, y: 50 },
  velocity: { x: 0, y: 0 },
  force: { x: 0, y: 0 },
  prey: null,
  radius: actorSize,
  freezeTimer: 0,
  role: 'predator'
}
predators.set(0, predator)

function pursue () {
  state.predators.forEach(predator => {
    const min = { distance: Infinity }
    players.forEach(player => {
      const distance = getDist(predator.position, player.position)
      if (distance < min.distance) {
        predator.prey = player
        min.distance = distance
      }
    })
    const prey = predator.prey
    if (prey) {
      const preyDir = getDirection(predator.position, prey.position)
      const projection = project(prey.velocity, preyDir)
      const rejection = sub(prey.velocity, projection)
      const flee = 1 * (dot(norm(projection), preyDir) > 0)
      const fleeVelocity = add(rejection, mult(projection, flee))
      const distance = getDist(predator.position, prey.position)
      const advance = 5 + 0.5 * distance
      const targetVelocity = add(fleeVelocity, mult(preyDir, advance))
      const pursueForce = sub(targetVelocity, predator.velocity)
      const centerForce = mult(norm(predator.position), -1)
      const boundX = Math.abs(predator.position.x) < 0.5 * mapSize + 2 * nodeSpread
      const boundY = Math.abs(predator.position.x) < 0.5 * mapSize + 2 * nodeSpread
      const targetForce = boundX & boundY ? pursueForce : centerForce
      const best = { align: 0 }
      compass.forEach(compassDir => {
        const align = dot(compassDir, targetForce)
        if (align > best.align) {
          best.align = align
          predator.force = norm(compassDir)
        }
      })
    }
  })
}

function grow () {
  players.forEach(player => {
    player.buildTimer += dt / 5
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

function movePredators () {
  state.predators.forEach(predator => {
    if (predator.freezeTimer <= 0) {
      moveActor(predator)
    } else if (predator.freezeTimer > 0) {
      predator.freezeTimer -= dt
      predator.freezeTimer = Math.max(0, predator.freezeTimer)
    }
  })
}

function moveActor (actor) {
  actor.velocity.x += actor.force.x * dt * actorMovePower
  actor.velocity.y += actor.force.y * dt * actorMovePower
  actor.position.x += actor.velocity.x * dt
  actor.position.y += actor.velocity.y * dt
  actor.velocity = mult(actor.velocity, 1 - dt * drag)
}

function setupWalls () {
  const wallThickness = 10
  const wallPadding = -20
  const wallLength = mapSize + wallPadding
  const topWall = {
    position: { x: 0, y: -0.5 * wallLength },
    width: wallLength + wallThickness,
    height: wallThickness,
    id: state.walls.length,
    role: 'wall'
  }
  state.walls.push(topWall)
  const bottomWall = {
    position: { x: 0, y: 0.5 * wallLength },
    width: wallLength + wallThickness,
    height: wallThickness,
    id: state.walls.length,
    role: 'wall'
  }
  state.walls.push(bottomWall)
  const leftWall = {
    position: { x: -0.5 * wallLength, y: 0 },
    width: wallThickness,
    height: wallLength + wallThickness,
    id: state.walls.length,
    role: 'wall'
  }
  state.walls.push(leftWall)
  const rightWall = {
    position: { x: 0.5 * wallLength, y: 0 },
    width: wallThickness,
    height: wallLength + 0.5 * wallThickness,
    id: state.walls.length,
    role: 'wall'
  }
  state.walls.push(rightWall)
}

function setupNodes () {
  range(100000).forEach(i => {
    const position = {
      x: (Math.random() - 0.5) * (mapSize - 4 * nodeSize),
      y: (Math.random() - 0.5) * (mapSize - 4 * nodeSize)
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
  state.predators = Array.from(predators.values())
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
  socket.on('updateServer', message => {
    player.controls = message.controls
  })
  socket.on('disconnect', () => {
    console.log('disconnect:', socket.id)
    sockets.delete(socket.id)
    players.delete(socket.id)
    predators.delete(socket.id)
  })
})
