import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { equalTo, get, onDisconnect, onValue, orderByChild, query, ref, runTransaction, serverTimestamp, set, update } from 'firebase/database'
import { db, ensureIdentity, firebaseReady } from './firebase'
import EntryScreen from './EntryScreen'
import ControlsScreen from './ControlsScreen'
import { arenaConfig, clamp, code as makeCode, COLORS, elapsedFor, ROUNDS, roundFor, secondsLeft } from './model'
import type { Player, Room } from './model'

type Screen = 'home' | 'entry' | 'lobby' | 'controls' | 'game' | 'results'
const emptyRoomError = 'Room not found. Check the code and try again.'
const pad = (n: number) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0')
const friendlyRoomError = (error: unknown, fallback: string) => {
  const value = error as { code?: string; message?: string; name?: string }
  const code = value?.code ?? ''
  const message = value?.message ?? ''
  if (/permission|unavailable|network|disconnected|internal|database\/|auth\//i.test(code) || value?.name === 'FirebaseError' || /FirebaseError|permission_denied|PERMISSION_DENIED|Firebase:/i.test(message)) return 'We couldn’t connect right now. Please try again.'
  const safeMessages = [emptyRoomError, 'This match has already started.', 'This room is full (8/8).', 'Could not reserve a room. Please try again.', 'The room host removed you from this room.', 'Firebase is blocking anonymous account creation. In Firebase Console, enable Authentication → Sign-in method → Anonymous. Also check Authentication → Settings → User actions and allow users to create accounts.', 'This site is not authorized for Firebase sign-in. Add its domain under Firebase Console → Authentication → Settings → Authorized domains.']
  return safeMessages.includes(message) ? message : fallback
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [entryMode, setEntryMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [availableRooms, setAvailableRooms] = useState<{ code: string; hostName: string; count: number }[]>([])
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [roomsError, setRoomsError] = useState('')
  const [roomsRetry, setRoomsRetry] = useState(0)
  const [room, setRoom] = useState<Room | null>(null)
  const [uid, setUid] = useState('')
  const [offset, setOffset] = useState(0)
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting' | 'lost'>('connecting')
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [joystick, setJoystick] = useState({ x: 0, y: 0 })
  const [dashUntil, setDashUntil] = useState(0)
  const [lastRound, setLastRound] = useState(-1)
  const moveRef = useRef({ x: 0, y: 0 })
  const keysRef = useRef(new Set<string>())
  const posRef = useRef({ x: 50, y: 50 })
  const lastSend = useRef(0)
  const dashRef = useRef(0)
  const joystickRef = useRef<HTMLDivElement>(null)
  const prevScreen = useRef<Screen>('home')
  const hasConnected = useRef(false)

  const me = room?.players?.[uid]
  const hasMe = Boolean(me)
  const players = Object.entries(room?.players ?? {}).filter(([, p]) => p.active).sort((a, b) => b[1].score - a[1].score)
  const finalPlayers = Object.entries(room?.players ?? {}).sort((a, b) => b[1].score - a[1].score)
  const elapsed = elapsedFor(room?.game, now + offset)
  const elapsedSecond = Math.floor(elapsed)
  const roundIndex = roundFor(elapsed)
  const remaining = secondsLeft(elapsed)
  const event = ROUNDS[roundIndex]
  const myRef = uid && roomCode && db ? ref(db, `rooms/${roomCode}/players/${uid}`) : null
  const roundRef = useRef(roundIndex)
  roundRef.current = roundIndex

  useEffect(() => {
    if (!db) return
    const off = onValue(ref(db, '.info/serverTimeOffset'), snap => setOffset(Number(snap.val() ?? 0)))
    let lostTimer = 0
    const offConnection = onValue(ref(db, '.info/connected'), snap => {
      if (snap.val() === true) {
        hasConnected.current = true
        window.clearTimeout(lostTimer)
        setConnection('connected')
        setNow(Date.now())
      } else {
        window.clearTimeout(lostTimer)
        setConnection(hasConnected.current ? 'reconnecting' : 'connecting')
        if (hasConnected.current) lostTimer = window.setTimeout(() => setConnection('lost'), 5000)
      }
    }, err => {
      console.error('Firebase connection status failed:', err)
      setConnection(hasConnected.current ? 'lost' : 'connecting')
    })
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    const refresh = () => setNow(Date.now())
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => { off(); offConnection(); window.clearTimeout(lostTimer); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh) }
  }, [])

  useEffect(() => {
    if (connection !== 'connected' || !db || !roomCode) return
    void get(ref(db, `rooms/${roomCode}`)).then(snapshot => {
      if (snapshot.exists()) setRoom(snapshot.val() as Room)
    }).catch(err => console.error('Room state resync failed:', err))
  }, [connection, roomCode])

  useEffect(() => {
    if (!db || screen !== 'entry' || entryMode !== 'join') return
    const database = db
    let stopped = false
    let unsubscribe: (() => void) | undefined
    setLoadingRooms(true); setRoomsError('')
    void ensureIdentity().then(user => {
      if (stopped) return
      setUid(user.uid)
      const publicRoomsQuery = query(ref(database, 'rooms'), orderByChild('discoverable'), equalTo(true))
      unsubscribe = onValue(publicRoomsQuery, snapshot => {
        const rows = Object.entries((snapshot.val() ?? {}) as Record<string, Room>).flatMap(([code, item]) => {
          const people = Object.values(item.players ?? {}).filter(player => player.active).length
          if (item.visibility !== 'public' || item.status !== 'lobby' || item.game || people >= 8 || Object.keys(item.seats ?? {}).length >= 8 || !item.hostName || !item.players?.[item.hostId]?.active) return []
          return [{ code, hostName: item.hostName, count: people }]
        }).sort((a, b) => a.code.localeCompare(b.code))
        setAvailableRooms(rows); setLoadingRooms(false); setRoomsError('')
      }, err => {
        console.error('Available rooms listener failed:', err)
        setAvailableRooms([]); setLoadingRooms(false); setRoomsError('ROOMS TEMPORARILY UNAVAILABLE')
      })
    }).catch(err => {
      console.error('Could not authenticate to browse rooms:', err)
      if (!stopped) { setLoadingRooms(false); setRoomsError('ROOMS TEMPORARILY UNAVAILABLE') }
    })
    return () => { stopped = true; unsubscribe?.() }
  }, [screen, entryMode, roomsRetry])

  useEffect(() => {
    if (!db) return
    const database = db
    const savedCode = localStorage.getItem('chaos-circuit-room')
    if (!savedCode) return
    setName(localStorage.getItem('chaos-circuit-name') ?? '')
    void ensureIdentity().then(async user => {
      const roomSnap = await get(ref(database, `rooms/${savedCode}`))
      const savedRoom = roomSnap.val() as Room | null
      if (!savedRoom?.players?.[user.uid]) { localStorage.removeItem('chaos-circuit-room'); return }
      setUid(user.uid); setRoomCode(savedCode)
      await update(ref(database, `rooms/${savedCode}/players/${user.uid}`), { active: true })
      void onDisconnect(ref(database, `rooms/${savedCode}/players/${user.uid}/active`)).set(false)
    }).catch(e => { console.error('Room restore failed:', e); setError(friendlyRoomError(e, 'Could not restore the previous room. Please try again.')) })
  }, [])

  useEffect(() => {
    if (!db || !roomCode || screen === 'entry' || screen === 'home') return
    const database = db
    const unsub = onValue(ref(database, `rooms/${roomCode}`), snap => {
      const data = snap.val() as Room | null
      if (!data) { setRoom(null); setError(emptyRoomError); setScreen('entry'); return }
      setError(current => current === 'Your connection was interrupted. Reconnecting...' ? '' : current)
      setRoom(data)
      if (data.players?.[uid]?.kicked) {
        localStorage.removeItem('chaos-circuit-room')
        setError('The room host removed you from this room.')
        setRoomCode(''); setRoom(null); setScreen('entry')
        return
      }
      if (data.hostId !== uid && data.players?.[data.hostId]?.active === false) {
        const successor = Object.entries(data.players ?? {}).filter(([, p]) => p.active).sort((a, b) => a[1].seat - b[1].seat)[0]?.[0]
        if (successor === uid) void runTransaction(ref(database, `rooms/${roomCode}/hostId`), current => current === data.hostId ? uid : undefined).then(result => {
          if (result.committed) void set(ref(database, `rooms/${roomCode}/hostName`), data.players?.[uid]?.name ?? 'Runner')
        }).catch(err => console.error('Host reassignment failed:', err))
      }
      const ownPlayer = data.players?.[uid]
      if (data.status === 'lobby' && !data.game && ownPlayer && (ownPlayer.score !== 0 || ownPlayer.x !== 50 || ownPlayer.y !== 50 || !ownPlayer.active)) {
        void update(ref(database, `rooms/${roomCode}/players/${uid}`), { score: 0, scoreTick: 0, x: 50, y: 50, active: true })
      }
      if (data.game && elapsedFor(data.game, Date.now() + offset) >= 180) {
        if (data.status !== 'finished' && data.hostId === uid) {
          void set(ref(database, `rooms/${roomCode}/status`), 'finished')
          void set(ref(database, `rooms/${roomCode}/game/status`), 'finished')
        }
        setScreen('results')
      } else if (data.game?.status === 'playing') setScreen('game')
      else if (data.status === 'lobby' && data.players?.[uid]) setScreen(current => current === 'controls' ? current : 'lobby')
      else if (data.status === 'finished') setScreen('results')
    }, err => { console.error('Room listener failed:', err); setError('Your connection was interrupted. Reconnecting...') })
    return () => unsub()
  }, [roomCode, uid, offset, screen])

  useEffect(() => {
    if (!room?.game || !uid || !db || !myRef || remaining <= 0) return
    const tick = elapsedSecond
    if (tick <= 0 || me?.scoreTick === tick) return
    const p = posRef.current
    const segment = Math.floor(elapsed / 5)
    const conf = arenaConfig(room.game.seed, roundIndex, segment)
    let delta = 2
    if (roundIndex === 0 && Math.floor(p.x / (100 / 7)) === conf.tileX && Math.floor(p.y / 20) === conf.tileY) delta = -3
    if (roundIndex === 1) delta = Math.hypot((p.x - conf.safeX) * 0.88, (p.y - conf.safeY)) < 12 ? 5 : -2
    if (roundIndex === 3 && (Math.abs(p.x - conf.wallX) < 3 || Math.abs(p.x - (100 - conf.wallX / 1.1)) < 3)) delta = -2
    if (roundIndex === 5) {
      const radius = 47 - Math.max(0, elapsed - 150) * 0.55
      if (Math.abs(p.x - 50) > radius || Math.abs(p.y - 50) > radius) delta = -3
    }
    void runTransaction(myRef, current => {
      if (!current || current.scoreTick >= tick) return
      return { ...current, score: Math.max(0, (current.score ?? 0) + delta), scoreTick: tick }
    })
  }, [elapsedSecond, room?.game, roundIndex, uid, me?.scoreTick, myRef])

  useEffect(() => {
    if (!room?.game || remaining > 0) return
    setScreen('results')
    if (db && room.hostId === uid && room.status !== 'finished') {
      void set(ref(db, `rooms/${roomCode}/status`), 'finished')
      void set(ref(db, `rooms/${roomCode}/game/status`), 'finished')
    }
  }, [room?.game, remaining, room?.hostId, room?.status, uid, roomCode])

  useEffect(() => {
    if (!room?.game || remaining <= 0 || roundIndex === lastRound) return
    if (lastRound >= 0) setLastRound(roundIndex)
    else setLastRound(roundIndex)
  }, [roundIndex, remaining, room?.game, lastRound])

  const joinExisting = useCallback(async (code: string, playerName: string, create = false) => {
    if (!db) { setError('Multiplayer is not configured yet. Add Firebase environment settings first.'); return }
    setBusy(true); setError('')
    try {
      const user = await ensureIdentity(); setUid(user.uid)
      const cleanName = playerName.trim().slice(0, 16) || 'Runner'
      if (create) {
        let chosen = ''
        for (let i = 0; i < 8; i++) {
          const candidate = makeCode()
          const roomRef = ref(db, `rooms/${candidate}`)
          const result = await runTransaction(roomRef, current => current === null ? {
            hostId: user.uid, hostName: cleanName, visibility, discoverable: visibility === 'public', status: 'lobby', createdAt: serverTimestamp(),
            seats: { 0: user.uid },
            players: { [user.uid]: { name: cleanName, color: COLORS[0], x: 50, y: 50, score: 0, scoreTick: 0, active: true, seat: 0, ready: true } },
          } : undefined)
          if (result.committed) { chosen = candidate; break }
        }
        if (!chosen) throw new Error('Could not reserve a room. Please try again.')
        setRoomCode(chosen); setScreen('lobby')
        localStorage.setItem('chaos-circuit-room', chosen); localStorage.setItem('chaos-circuit-name', cleanName)
        void onDisconnect(ref(db, `rooms/${chosen}/players/${user.uid}/active`)).set(false)
      } else {
        const roomRef = ref(db, `rooms/${code}`)
        const snapshot = await get(roomRef)
        if (!snapshot.exists()) throw new Error(emptyRoomError)
        const existing = snapshot.val() as Room
        if (existing.status !== 'lobby') throw new Error('This match has already started.')
        if (existing.players?.[user.uid]?.kicked) throw new Error('The room host removed you from this room.')
        if (existing.players?.[user.uid] && existing.seats?.[String(existing.players[user.uid].seat)] === user.uid) {
          setRoomCode(code); setScreen(existing.status === 'lobby' ? 'lobby' : 'game')
          localStorage.setItem('chaos-circuit-room', code); localStorage.setItem('chaos-circuit-name', cleanName)
          await update(ref(db, `rooms/${code}/players/${user.uid}`), { active: true })
          void onDisconnect(ref(db, `rooms/${code}/players/${user.uid}/active`)).set(false)
          return
        }
        let seat = -1
        for (let i = 0; i < 8; i++) {
          const seatRef = ref(db, `rooms/${code}/seats/${i}`)
          const claim = await runTransaction(seatRef, current => current == null ? user.uid : undefined)
          if (claim.committed) { seat = i; break }
        }
        if (seat < 0) throw new Error('This room is full (8/8).')
        try {
          await set(ref(db, `rooms/${code}/players/${user.uid}`), { name: cleanName, color: COLORS[seat], x: 50, y: 50, score: 0, scoreTick: 0, active: true, seat, ready: true } satisfies Player)
        } catch (e) {
          await set(ref(db, `rooms/${code}/seats/${seat}`), null); throw e
        }
        setRoomCode(code); setScreen('lobby')
        localStorage.setItem('chaos-circuit-room', code); localStorage.setItem('chaos-circuit-name', cleanName)
        void onDisconnect(ref(db, `rooms/${code}/players/${user.uid}/active`)).set(false)
      }
    } catch (e) {
      console.error('Room action failed:', e)
      setError(friendlyRoomError(e, 'Unable to complete that room action. Please try again.'))
    }
    finally { setBusy(false) }
  }, [visibility])

  const startGame = async () => {
    if (!db || !room || players.length < 2 || room.hostId !== uid) return
    try {
      const gRef = ref(db, `rooms/${roomCode}/game`)
      const result = await runTransaction(gRef, current => current ? undefined : { status: 'playing', gameStartTime: serverTimestamp(), seed: Math.floor(Math.random() * 1e9) })
      if (result.committed) await update(ref(db, `rooms/${roomCode}`), { status: 'playing', discoverable: false })
    } catch (e) { console.error('Start game failed:', e); setError(friendlyRoomError(e, 'Could not start the match. Please try again.')) }
  }

  const copyCode = async () => {
    await navigator.clipboard?.writeText(roomCode)
    setCopied(true); window.setTimeout(() => setCopied(false), 1400)
  }

  const removePlayer = async (playerId: string, seat: number) => {
    if (!db || !room || room.hostId !== uid || playerId === uid || room.status !== 'lobby') return
    try {
      await update(ref(db, `rooms/${roomCode}`), {
        [`players/${playerId}/active`]: false,
        [`players/${playerId}/kicked`]: true,
        [`seats/${seat}`]: null,
      })
    } catch (e) {
      console.error('Could not remove player:', e)
      setError(friendlyRoomError(e, 'Could not remove that player. Please try again.'))
    }
  }

  const goHome = () => {
    const current = room?.players?.[uid]
    if (db && current && roomCode) {
      void update(ref(db, `rooms/${roomCode}/players/${uid}`), { active: false })
      void set(ref(db, `rooms/${roomCode}/seats/${current.seat}`), null)
    }
    localStorage.removeItem('chaos-circuit-room'); localStorage.removeItem('chaos-circuit-name'); setRoomCode(''); setRoom(null); setError(''); setLastRound(-1); setScreen('home')
  }
  const replay = async () => {
    if (!db || room?.hostId !== uid) return
    try {
      await update(ref(db, `rooms/${roomCode}`), { status: 'lobby', game: null, discoverable: room?.visibility === 'public' })
      await update(ref(db, `rooms/${roomCode}/players/${uid}`), { score: 0, scoreTick: 0, x: 50, y: 50, active: true })
      setLastRound(-1)
    } catch (e) { console.error('Rematch reset failed:', e); setError(friendlyRoomError(e, 'Could not reset the match. Please try again.')) }
  }

  useEffect(() => {
    if (screen !== 'game' || !myRef || !db || !hasMe) return
    posRef.current = { x: me?.x ?? 50, y: me?.y ?? 50 }
    let frame = 0
    let prev = performance.now()
    const loop = (t: number) => {
      const dt = Math.min(0.04, (t - prev) / 1000); prev = t
      const keys = keysRef.current
      let x = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'))
      let y = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'))
      if (Math.abs(moveRef.current.x) + Math.abs(moveRef.current.y) > 0.12) { x = moveRef.current.x; y = moveRef.current.y }
      const magnitude = Math.hypot(x, y) || 1
      x /= magnitude; y /= magnitude
      if (roundRef.current === 2) { x *= -1; y *= -1 }
      const speedRound = roundRef.current === 4 ? 37 : 26
      const dash = t < dashRef.current ? 2.05 : 1
      const speed = speedRound * dash * (roundRef.current === 4 && posRef.current.x > 37 && posRef.current.x < 63 ? 1.35 : 1)
      const radius = 49
      posRef.current = { x: clamp(posRef.current.x + x * speed * dt, 50 - radius, 50 + radius), y: clamp(posRef.current.y + y * speed * dt, 50 - radius, 50 + radius) }
      if (t - lastSend.current > 110) {
        lastSend.current = t
        void update(myRef, { x: posRef.current.x, y: posRef.current.y })
      }
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    const down = (e: KeyboardEvent) => { const k = e.key.toLowerCase(); if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault(); keysRef.current.add(k); if (k === ' ' && performance.now() > dashRef.current + 4500) { dashRef.current = performance.now() + 650; setDashUntil(Date.now() + 5000) } }
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key.toLowerCase())
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [screen, myRef, hasMe])

  const arena = useMemo(() => room?.game ? arenaConfig(room.game.seed, roundIndex, Math.floor(elapsed / 5)) : null, [room?.game, roundIndex, Math.floor(elapsed / 5)])
  const nextDash = () => {
    if (performance.now() <= dashRef.current + 4500) return
    dashRef.current = performance.now() + 650; setDashUntil(Date.now() + 5000)
  }
  const setStick = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect(); const dx = e.clientX - (rect.left + rect.width / 2); const dy = e.clientY - (rect.top + rect.height / 2)
    const len = Math.max(1, Math.hypot(dx, dy)); moveRef.current = { x: clamp(dx / len, -1, 1) * Math.min(1, len / 44), y: clamp(dy / len, -1, 1) * Math.min(1, len / 44) }; setJoystick(moveRef.current)
  }

  return <main className="app-shell">
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/>
    <header className="topbar"><button className="brand" onClick={goHome}><span className="brand-mark">C</span><span>CHAOS<span className="brand-light"> CIRCUIT</span></span></button><div className={`top-status connection-${firebaseReady ? connection : 'lost'}`} role="status" aria-live="polite"><span className={`status-dot ${connection==='connected'&&firebaseReady?'online':''}`}/>{!firebaseReady?'FIREBASE SETUP REQUIRED':connection==='connected'?'CONNECTED':connection==='lost'?'CONNECTION LOST':connection==='reconnecting'?'RECONNECTING...':'CONNECTING...'}</div></header>

    {screen === 'home' && <section className="landing">
      <div className="landing-copy"><div className="eyebrow"><span className="pulse-dot"/> LIVE MULTIPLAYER ARCADE</div><h1 className="hero-title"><span>CHAOS</span><span className="gradient-text">CIRCUIT</span></h1><div className="hero-subtitle">THE RULES KEEP CHANGING<span className="period">.</span></div><div className="hero-tagline">Can you keep up?</div><p className="hero-description">A fast-paced multiplayer arena where the rules never stay the same. Adapt fast. Outlast everyone.</p>
        <div className="stat-row"><div><b>02—08</b><small>PLAYERS</small></div><i/><div><b>03:00</b><small>MINUTES</small></div><i/><div><b>∞</b><small>CHAOS</small></div></div>
        <button className="primary-button play-button" onClick={() => { setError(''); setScreen('entry') }}><span>PLAY NOW</span><span className="button-arrow">↗</span></button><div className="no-download">◈ &nbsp; NO DOWNLOAD REQUIRED</div>
      </div>
      <div className="hero-art hero-arena"><div className="art-sky"><span>ARENA 01 / NEON DISTRICT</span><b><i/> LIVE</b></div><div className="art-sparks"><i>✦</i><i>✧</i><i>✦</i><i>✧</i></div><div className="art-track"><div className="track-grid">{Array.from({length:24},(_,i)=><i key={i}/>)}</div><div className="track-glow"/><div className="hero-bot bot-blue"><i/><b/><em/></div><div className="hero-bot bot-pink"><i/><b/><em/></div><div className="hero-bot bot-lime"><i/><b/><em/></div><div className="hero-bot bot-gold"><i/><b/><em/></div></div><div className="art-floor-label"><span>✦ &nbsp; THE CIRCUIT IS LIVE</span><b>READY TO RUN? &nbsp; ↗</b></div><div className="floating-chip chip-a">◈ &nbsp; ROUND 04</div><div className="floating-chip chip-b">+240 <small>PTS</small></div></div><div className="how-strip"><div className="how-heading"><span className="section-kicker">THE LOOP</span><b>HOW TO PLAY</b></div>{[['01','JOIN A ROOM'],['02','STAY ALIVE'],['03','ADAPT FAST'],['04','TAKE THE CROWN']].map(([n,t])=><div className="how-step" key={n}><span>{n}</span><b>{t}</b><i>↗</i></div>)}</div>
      <div className="landing-foot"><span>READY WHEN YOU ARE</span><span>WASD / ARROWS TO MOVE &nbsp;·&nbsp; SPACE TO DASH</span><span>EST. IN CHAOS <b>2026</b></span></div>
    </section>}

    {screen === 'entry' && <EntryScreen name={name} setName={setName} roomCode={roomCode} setRoomCode={setRoomCode} visibility={visibility} setVisibility={setVisibility} availableRooms={availableRooms} loadingRooms={loadingRooms} roomsError={roomsError} retryRooms={()=>{setRoomsRetry(n=>n+1);setLoadingRooms(true)}} onJoinRoom={code=>{setRoomCode(code);void joinExisting(code,name)}} mode={entryMode} setMode={setEntryMode} busy={busy} configured={firebaseReady} onCreate={()=>joinExisting('',name,true)} onJoin={()=>joinExisting(roomCode,name)} onBack={goHome}/>}

    {screen === 'lobby' && <section className="stage lobby-stage"><div className="lobby-header"><div><div className="eyebrow"><span className="pulse-dot"/> PRE-MATCH LOBBY</div><h2>Assemble<br/><span className="gradient-text">your circuit.</span></h2></div><div className="room-token"><small>ROOM CODE</small><b>{roomCode}</b><button onClick={copyCode}>{copied?'COPIED ✓':'COPY ↗'}</button></div></div><div className="lobby-grid"><div className="panel roster-panel"><div className="panel-heading"><div><span className="section-kicker">THE LINEUP</span><h3>Players <span className="count-pill">{players.length}/8</span></h3></div><span className="live-tag"><i/> LIVE</span></div><div className="roster-scene"><div className="roster-list">{players.map(([id,p],i)=><div className={`roster-player ${id===uid?'is-you':''}`} key={id}><span className="player-rank">0{i+1}</span><span className="avatar" style={{'--player':p.color} as React.CSSProperties}>{p.name.slice(0,1).toUpperCase()}</span><span className="player-name">{p.name}{id===uid&&<small>YOU</small>}</span><span className="ready-state"><i/> READY</span>{id===room?.hostId&&<span className="host-chip">HOST</span>}{room?.hostId===uid&&id!==uid&&<button className="roster-kick" type="button" onClick={()=>void removePlayer(id,p.seat)}>REMOVE</button>}</div>)}{Array.from({length:Math.max(0,2-players.length)},(_,i)=><div className="roster-player waiting" key={`wait${i}`}><span className="player-rank">0{players.length+i+1}</span><span className="avatar empty-avatar">＋</span><span className="player-name">Waiting for player<span className="loading-dots">...</span></span><span className="ready-state waiting-state">OPEN SLOT</span></div>)}</div><div className="lobby-mini-arena"><div className="mini-platform"><i/><i/><i/><i/><i/><i/><i/><i/><b>●</b><em>●</em><strong>●</strong></div><span>ARENA PREVIEW</span></div></div><div className="roster-bottom"><span>◉ MINIMUM 2 PLAYERS TO START</span><span>{8-players.length} SLOTS OPEN</span></div>{room?.hostId===uid&&players.length>=2&&<button className="primary-button lobby-start" onClick={()=>void startGame()}><span>START THE GAME</span><span>↗</span></button>}</div><div className="panel briefing-panel"><span className="section-kicker">MISSION BRIEF</span><h3>Three minutes.<br/><span className="gradient-text">Six rule changes.</span></h3><p>Survive the shifting arena, watch the clock, and stack points while everyone else scrambles.</p><div className="round-list">{ROUNDS.map((r,i)=><div key={r.name} style={{'--event':r.color} as React.CSSProperties}><span>0{i+1}</span><i>{r.icon}</i><b>{r.name}</b><small>00:{String(i*30).padStart(2,'0')}</small></div>)}</div><button className="primary-button start-button" onClick={()=>setScreen('controls')}><span>HOW TO PLAY / CONTROLS</span><span>↗</span></button></div></div></section>}

    {screen === 'controls' && <ControlsScreen isHost={room?.hostId===uid} onBack={()=>setScreen('lobby')} onStart={startGame} players={players.length}/>}

    {screen === 'game' && room?.game && <section className="game-stage"><div className="game-top"><button className="game-brand" onClick={()=>{prevScreen.current=screen}}><span className="brand-mark">C</span>CHAOS CIRCUIT</button><div className="round-indicator"><span style={{color:event.color}}>{event.icon}</span><div><small>ROUND 0{roundIndex+1} / 06</small><b>{event.name}</b></div></div><div className="timer-box"><small>TIME LEFT</small><b className={remaining<=15?'urgent':''}>{pad(remaining)}</b></div><div className="live-badge"><i/> LIVE MATCH</div></div><div className="event-banner" style={{'--event':event.color} as React.CSSProperties}><span>{event.icon}</span><div><b>{event.title}</b><small>{event.hint}</small></div><span className="event-time">{pad(remaining)}</span></div><div className="game-layout"><div className="arena-wrap"><div className={`arena arena-round-${roundIndex}`}>
      {roundIndex===0&&arena&&Array.from({length:35},(_,i)=>{const x=i%7,y=Math.floor(i/7);const hot=x===arena.tileX&&y===arena.tileY;return <div key={i} className={`tile ${hot?'danger-tile':''}`} style={{left:`${x*14.285}%`,top:`${y*20}%`}}/>})}
      {roundIndex===1&&arena&&<div className="safe-zone" style={{left:`${arena.safeX}%`,top:`${arena.safeY}%`}}><span>SAFE</span></div>}
      {roundIndex===3&&arena&&<><div className="moving-wall wall-one" style={{left:`${arena.wallX}%`}}/><div className="moving-wall wall-two" style={{left:`${100-arena.wallX/1.1}%`}}/></>}
      {roundIndex===4&&[0,1,2].map(i=><div key={i} className="speed-lane" style={{left:`${37+i*9}%`}}>»</div>)}
      {roundIndex===5&&<div className="shrink-frame" style={{inset:`${Math.max(2,(elapsed-150)*0.55)}%`}}/>}
      {players.map(([id,p])=><div key={id} className={`runner ${id===uid?'runner-me':''}`} style={{left:`${id===uid?posRef.current.x:p.x}%`,top:`${id===uid?posRef.current.y:p.y}%`,'--player':p.color} as React.CSSProperties}><span className="runner-glow"/><span className="runner-dot"/>{id===uid&&<span className="runner-label">YOU</span>}<span className="runner-name">{p.name}</span></div>)}
      </div><div className="arena-legend"><span><i className="legend-safe"/> SAFE</span><span><i className="legend-danger"/> HAZARD</span><span><i className="legend-player"/> RUNNERS</span></div><div className="mobile-controls"><div className="joystick" ref={joystickRef} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);setStick(e)}} onPointerMove={e=>e.buttons===1&&setStick(e)} onPointerUp={()=>{moveRef.current={x:0,y:0};setJoystick({x:0,y:0})}}><div className="stick-knob" style={{transform:`translate(${joystick.x*24}px, ${joystick.y*24}px)`}}/><small>MOVE</small></div><button className={`dash-button ${Date.now()<dashUntil?'dash-cooling':''}`} onPointerDown={nextDash}><b>DASH</b><span>SPACE</span></button></div></div><aside className="score-panel panel"><div className="score-heading"><span className="section-kicker">LIVE RANKING</span><b>TOP RUNNERS</b></div><div className="score-list">{players.map(([id,p],i)=><div className={`score-player ${id===uid?'is-you':''}`} key={id}><span className="score-place">{String(i+1).padStart(2,'0')}</span><span className="score-avatar" style={{'--player':p.color} as React.CSSProperties}>{p.name.slice(0,1).toUpperCase()}</span><span className="score-name">{p.name}{id===uid&&<small>YOU</small>}</span><b className="score-number">{p.score??0}<small>PTS</small></b></div>)}</div><div className="your-score"><small>YOUR SCORE</small><b>{me?.score??0}<span>PTS</span></b><div className="score-meter"><i style={{width:`${Math.min(100,((me?.score??0)%1000)/10)}%`}}/></div></div><div className="control-hint"><span>⌨</span><div><b>WASD / ARROWS</b><small>MOVE AROUND</small></div></div></aside></div><div className="game-footer"><span>SYNCED TO ARENA CLOCK</span><span>ROUND ENDS IN <b>{pad(remaining%30||30)}</b></span><span>STAY IN THE CIRCUIT <b>✦</b></span></div></section>}

    {screen === 'results' && <section className="stage results-stage"><div className="results-head"><div className="eyebrow"><span className="pulse-dot"/> CIRCUIT COMPLETE</div><h2>GAME <span className="gradient-text">OVER.</span></h2><p>The dust settles. The scores are in.</p></div><div className="podium">{finalPlayers.slice(0,3).map(([id,p],i)=><div className={`podium-card place-${i+1} ${i===0?'winner':''}`} key={id}><span className="medal">{['✦','✧','✧'][i]}</span><span className="podium-avatar" style={{'--player':p.color} as React.CSSProperties}>{p.name.slice(0,1).toUpperCase()}</span><small>{['1ST PLACE','2ND PLACE','3RD PLACE'][i]}</small><b>{p.name}</b><strong>{p.score}<small> PTS</small></strong>{i===0&&<div className="winner-chip">WINNER</div>}</div>)}</div><div className="panel final-score"><div className="panel-heading"><div><span className="section-kicker">FINAL STANDINGS</span><h3>Full leaderboard</h3></div><span className="room-final">ROOM {roomCode}</span></div>{finalPlayers.map(([id,p],i)=><div className="final-row" key={id}><span>{String(i+1).padStart(2,'0')}</span><i style={{'--player':p.color} as React.CSSProperties}/><b>{p.name}{id===uid&&<small>YOU</small>}</b><strong>{p.score} <small>PTS</small></strong></div>)}</div><div className="results-actions">{room?.hostId===uid&&<button className="primary-button" onClick={replay}>PLAY AGAIN <span>↗</span></button>}<button className="secondary-button" onClick={goHome}>BACK TO HOME <span>⌂</span></button></div></section>}

    {error&&<div className="toast" role="alert"><span>!</span>{error}<button onClick={()=>setError('')}>×</button></div>}
    <footer className="app-footer"><span>CHAOS CIRCUIT <i>© 2026</i></span><span>PLAY NICE. MOVE FAST. EMBRACE THE CHAOS.</span><span>BUILT FOR THE UNPREDICTABLE <b>✦</b></span></footer>
  </main>
}


