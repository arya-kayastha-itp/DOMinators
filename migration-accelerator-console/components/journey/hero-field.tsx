'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Color, type ShaderMaterial, Vector2 } from 'three'

// ---------------------------------------------------------------------------
// Hero background: one full-screen shader plane. Domain-warped fbm noise in
// the accent colour, brightened around the (lerped) mouse position. Loaded
// with next/dynamic only on desktop; the render loop stops while the hero is
// off screen.
// ---------------------------------------------------------------------------

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0); // clip space: ignore the camera
  }
`

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform vec2 uRes;
  uniform vec3 uAccent;
  uniform vec3 uTint;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  void main() {
    float aspect = uRes.x / uRes.y;
    vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
    vec2 m = (uMouse - 0.5) * vec2(aspect, 1.0);
    float t = uTime * 0.05;

    // Domain warp: the noise field bends toward the cursor.
    vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 4.2));
    vec2 toMouse = m - p;
    float d = length(toMouse);
    float pull = exp(-d * 2.2);
    float n = fbm(p * 1.8 + q * 1.3 + toMouse * pull * 0.6 + vec2(t * 0.6, -t));

    float band = smoothstep(0.42, 0.92, n);
    vec3 col = vec3(0.027, 0.027, 0.039);
    col = mix(col, uAccent * 0.72, band * (0.36 + pull * 1.1));
    col += uTint * pow(pull, 3.0) * band * 0.28;

    // Vignette + keep the lower third dark so the copy stays readable.
    col *= smoothstep(1.35, 0.15, length(p * vec2(0.75, 1.0)));
    col *= mix(0.55, 1.0, smoothstep(0.0, 0.55, vUv.y));
    gl_FragColor = vec4(col, 1.0);
  }
`

function Field() {
  const mat = useRef<ShaderMaterial>(null)
  const size = useThree((s) => s.size)
  const target = useRef(new Vector2(0.62, 0.62))

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new Vector2(0.62, 0.62) },
      uRes: { value: new Vector2(1, 1) },
      uAccent: { value: new Color('#8f6bff') },
      uTint: { value: new Color('#e9e2ff') },
    }),
    [],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => target.current.set(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight)
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useFrame((_, delta) => {
    if (!mat.current) return
    const u = mat.current.uniforms
    u.uTime.value += delta
    u.uRes.value.set(size.width, size.height)
    // Frame-rate independent lerp toward the pointer: slow, liquid follow.
    u.uMouse.value.lerp(target.current, 1 - Math.pow(0.04, delta))
  })

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={mat} vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} depthWrite={false} />
    </mesh>
  )
}

export default function HeroField() {
  const wrap = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  const [ready, setReady] = useState(false)

  // Stop rendering entirely while the hero is scrolled away.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={wrap} className="absolute inset-0 transition-opacity duration-[1600ms]" style={{ opacity: ready ? 1 : 0 }} aria-hidden>
      <Canvas
        dpr={[1, 1.5]}
        frameloop={visible ? 'always' : 'never'}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        onCreated={() => setReady(true)}
      >
        <Field />
      </Canvas>
    </div>
  )
}
