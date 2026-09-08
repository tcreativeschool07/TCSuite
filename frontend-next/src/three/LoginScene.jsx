'use client'

// "Ruled paper, breathing" — the app's only Three.js moment, confined
// to /login. A wireframe grid of thin lines (ruled ledger paper) displaced by
// two slow layered sine waves, fog toward the horizon, a few drifting points.
// Nothing spins, nothing bounces. Pointer parallax ≤ ±1.5°, damped; disabled
// on touch. Loop pauses when the tab is hidden; geometry/material disposed on
// unmount. This module is loaded with next/dynamic({ ssr: false }) so zero
// bytes of three reach the (app) bundle.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

const BASE = '#0E130F'
const LINE = '#2E7A5F'
const POINT = '#5CB894'

// Grid dimensions: a wide plane, ~60×36 segments.
const W = 44, D = 26, NX = 60, NZ = 36

function wave(x, z, t) {
  return (
    0.5 * Math.sin(x * 0.32 + t * 0.72) * Math.sin(z * 0.45 + t * 0.5) +
    0.3 * Math.sin((x + z) * 0.2 + t * 0.35)
  )
}

function buildGridGeometry() {
  // Line segments along both axes of the grid → ruled paper, no triangle
  // diagonals (a plain wireframe mesh would show them).
  const verts = []
  const dx = W / NX, dz = D / NZ
  for (let iz = 0; iz <= NZ; iz++) {
    const z = -D / 2 + iz * dz
    for (let ix = 0; ix < NX; ix++) {
      const x = -W / 2 + ix * dx
      verts.push(x, 0, z, x + dx, 0, z)
    }
  }
  for (let ix = 0; ix <= NX; ix++) {
    const x = -W / 2 + ix * dx
    for (let iz = 0; iz < NZ; iz++) {
      const z = -D / 2 + iz * dz
      verts.push(x, 0, z, x, 0, z + dz)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  return geometry
}

function Paper() {
  const geometry = useMemo(() => buildGridGeometry(), [])
  const material = useMemo(
    () => new THREE.LineBasicMaterial({ color: LINE, transparent: true, opacity: 0.35, fog: true }),
    []
  )

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const pos = geometry.attributes.position
    const arr = pos.array
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] = wave(arr[i], arr[i + 2], t)
    }
    pos.needsUpdate = true
  })

  return <lineSegments geometry={geometry} material={material} />
}

function Drift() {
  const count = 48
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const p = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * W
      p[i * 3 + 1] = Math.random() * 8 + 0.5
      p[i * 3 + 2] = (Math.random() - 0.5) * D
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    return g
  }, [])
  const material = useMemo(
    () => new THREE.PointsMaterial({ color: POINT, size: 0.06, transparent: true, opacity: 0.2, fog: true }),
    []
  )

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  useFrame((_, delta) => {
    const arr = geometry.attributes.position.array
    for (let i = 1; i < arr.length; i += 3) {
      arr[i] += delta * 0.12
      if (arr[i] > 9) arr[i] = 0.5
    }
    geometry.attributes.position.needsUpdate = true
  })

  return <points geometry={geometry} material={material} />
}

function Rig({ parallax }) {
  const { camera } = useThree()
  const target = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (!parallax) return
    const onMove = (e) => {
      target.current.x = (e.clientX / window.innerWidth) * 2 - 1
      target.current.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [parallax])

  useFrame(() => {
    // ±1.5° max tilt, damped (lerp 0.05)
    const maxTilt = 0.026
    const rx = -0.28 + target.current.y * maxTilt
    const ry = -target.current.x * maxTilt
    camera.rotation.x += (rx - camera.rotation.x) * 0.05
    camera.rotation.y += (ry - camera.rotation.y) * 0.05
  })
  return null
}

export default function LoginScene() {
  const [frameloop, setFrameloop] = useState('always')
  const [parallax, setParallax] = useState(false)

  useEffect(() => {
    // Pause the render loop when the tab is hidden.
    const onVis = () => setFrameloop(document.hidden ? 'never' : 'always')
    document.addEventListener('visibilitychange', onVis)
    // No parallax on touch devices.
    setParallax(!window.matchMedia('(pointer: coarse)').matches)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  return (
    <Canvas
      frameloop={frameloop}
      dpr={[1, 1.5]}
      camera={{ position: [0, 2.4, 10], fov: 55, rotation: [-0.28, 0, 0] }}
      gl={{ antialias: true, alpha: false }}
      style={{ position: 'absolute', inset: 0 }}
      aria-hidden="true"
    >
      <color attach="background" args={[BASE]} />
      <fog attach="fog" args={[BASE, 7, 24]} />
      <Paper />
      <Drift />
      <Rig parallax={parallax} />
    </Canvas>
  )
}
