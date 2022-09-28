export const up = { x: 0, y: -1 }
export const down = { x: 0, y: 1 }
export const left = { x: -1, y: 0 }
export const right = { x: 1, y: 0 }

export function getLength (v) {
  return Math.sqrt(v.x * v.x + v.y * v.y)
}

export function getDist (a, b) {
  const vector = {
    x: b.x - a.x,
    y: b.y - a.y
  }
  return getLength(vector)
}

export function mult (vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar
  }
}

export function norm (vector) {
  const length = getLength(vector)
  if (length === 0) return { x: 0, y: 0 }
  return mult(vector, 1 / length)
}

export function add (a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y
  }
}

export function sub (a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y
  }
}

export function getArrow (a, b) {
  return sub(b, a)
}

export function getDirection (a, b) {
  return norm(getArrow(a, b))
}

export function dot (a, b) {
  return a.x * b.x + a.y * b.y
}

export function project (a, b) {
  if (dot(b, b) === 0) return { x: 0, y: 0 }
  const scale = dot(a, b) / dot(b, b)
  return mult(b, scale)
}

export function reject (a, b) {
  return sub(a, project(a, b))
}

export function copyVector (vector) {
  return { x: vector.x, y: vector.y }
}
