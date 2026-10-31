type EntryScreenProps = {
  name: string
  setName: (name: string) => void
  roomCode: string
  setRoomCode: (code: string) => void
  visibility: 'public' | 'private'
  setVisibility: (visibility: 'public' | 'private') => void
  availableRooms: { code: string; hostName: string; count: number }[]
  loadingRooms: boolean
  roomsError: string
  retryRooms: () => void
  mode: 'create' | 'join'
  setMode: (mode: 'create' | 'join') => void
  busy: boolean
  configured: boolean
  onCreate: () => void
  onJoin: () => void
  onJoinRoom: (code: string) => void
  onBack: () => void
}

export default function EntryScreen({ name, setName, roomCode, setRoomCode, visibility, setVisibility, availableRooms, loadingRooms, roomsError, retryRooms, mode, setMode, busy, configured, onCreate, onJoin, onBack, onJoinRoom }: EntryScreenProps) {
  return <section className="stage entry-stage"><button className="back-link" onClick={onBack}>← BACK</button><div className="entry-layout"><div className="entry-intro"><div className="eyebrow"><span className="pulse-dot"/> YOUR NEXT MOVE</div><h2>Find your<br/><span className="gradient-text">people.</span></h2><p>Create a fresh circuit or enter a code and join the action.</p><div className="entry-perks"><span>♟ &nbsp; 2–8 PLAYERS</span><span>◷ &nbsp; 3 MINUTE MATCHES</span><span>✦ &nbsp; 6 RULE CHANGES</span></div><div className="entry-floor"><i/><i/><i/><i/><b>✦</b></div></div><div className="panel entry-card"><div className="card-topline"><span>PLAYER SETUP</span><span>01 / 02</span></div><div className="entry-tabs"><button className={mode==='create'?'active':''} onClick={()=>setMode('create')}>CREATE ROOM</button><button className={mode==='join'?'active':''} onClick={()=>setMode('join')}>JOIN ROOM</button></div><h3>{mode==='create'?'Build your circuit':'Find a circuit'}</h3><label className="input-label">YOUR NAME</label><input className="text-input" value={name} maxLength={16} placeholder="e.g. neonrunner" onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&(mode==='create'?onCreate():onJoin())}/>{mode==='create'&&<div className="visibility-picker"><span className="input-label">ROOM VISIBILITY</span><div><button type="button" className={visibility==='public'?'selected':''} onClick={()=>setVisibility('public')}>PUBLIC <small>Shown in room list</small></button><button type="button" className={visibility==='private'?'selected':''} onClick={()=>setVisibility('private')}>PRIVATE <small>Code only</small></button></div></div>}{mode==='join'&&<><label className="input-label room-label">JOIN WITH ROOM CODE</label><input className="text-input code-input" value={roomCode} maxLength={5} placeholder="XXXXX" onChange={e=>setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} onKeyDown={e=>e.key==='Enter'&&onJoin()}/><button className="primary-button entry-submit" disabled={busy||roomCode.length<4} onClick={onJoin}><span>{busy?'CONNECTING…':'JOIN WITH CODE'}</span><span>↗</span></button><div className="available-rooms"><div className="available-heading"><span className="input-label">AVAILABLE ROOMS</span><button type="button" onClick={retryRooms} aria-label="Refresh available rooms">↻</button></div>{loadingRooms?<div className="rooms-message">LOADING ROOMS...</div>:roomsError?<div className="rooms-message">{roomsError}<button type="button" onClick={retryRooms}>RETRY</button></div>:availableRooms.length===0?<div className="rooms-message">NO ROOMS AVAILABLE — CREATE ONE OR JOIN WITH A ROOM CODE</div>:<div className="available-list">{availableRooms.map(r=><div className="available-room" key={r.code}><div><b>{r.code}</b><span>{r.hostName}</span></div><div className="available-room-meta"><span>{r.count} / 8 PLAYERS</span><small>WAITING FOR PLAYERS</small></div><button type="button" disabled={busy} onClick={()=>onJoinRoom(r.code)}>JOIN</button></div>)}</div>}</div></>}{mode==='create'&&<button className="primary-button entry-submit" disabled={busy} onClick={onCreate}><span>{busy?'CONNECTING…':'CREATE ROOM'}</span><span>↗</span></button>}<div className="entry-foot"><span>◉ 2–8 PLAYERS</span><span>◷ 03:00</span><span>✦ FREE TO PLAY</span></div>{!configured&&<div className="setup-note">Multiplayer activates when Firebase config is added.</div>}</div></div></section>
}
