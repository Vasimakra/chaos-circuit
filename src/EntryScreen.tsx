type EntryScreenProps = {
  name: string
  setName: (name: string) => void
  roomCode: string
  setRoomCode: (code: string) => void
  mode: 'create' | 'join'
  setMode: (mode: 'create' | 'join') => void
  busy: boolean
  configured: boolean
  onCreate: () => void
  onJoin: () => void
  onBack: () => void
}

export default function EntryScreen({ name, setName, roomCode, setRoomCode, mode, setMode, busy, configured, onCreate, onJoin, onBack }: EntryScreenProps) {
  return <section className="stage entry-stage"><button className="back-link" onClick={onBack}>← BACK</button><div className="entry-layout"><div className="entry-intro"><div className="eyebrow"><span className="pulse-dot"/> YOUR NEXT MOVE</div><h2>Find your<br/><span className="gradient-text">people.</span></h2><p>Create a fresh circuit or enter a code and join the action.</p><div className="entry-perks"><span>♟ &nbsp; 2–8 PLAYERS</span><span>◷ &nbsp; 3 MINUTE MATCHES</span><span>✦ &nbsp; 6 RULE CHANGES</span></div><div className="entry-floor"><i/><i/><i/><i/><b>✦</b></div></div><div className="panel entry-card"><div className="card-topline"><span>PLAYER SETUP</span><span>01 / 02</span></div><div className="entry-tabs"><button className={mode==='create'?'active':''} onClick={()=>setMode('create')}>CREATE ROOM</button><button className={mode==='join'?'active':''} onClick={()=>setMode('join')}>JOIN ROOM</button></div><h3>{mode==='create'?'Build your circuit':'Enter the code'}</h3><label className="input-label">YOUR NAME</label><input className="text-input" value={name} maxLength={16} placeholder="e.g. neonrunner" onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&(mode==='create'?onCreate():onJoin())}/>{mode==='join'&&<><label className="input-label room-label">ROOM CODE</label><input className="text-input code-input" value={roomCode} maxLength={5} placeholder="XXXXX" onChange={e=>setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} onKeyDown={e=>e.key==='Enter'&&onJoin()}/></>}<button className="primary-button entry-submit" disabled={busy||(mode==='join'&&roomCode.length<4)} onClick={mode==='create'?onCreate:onJoin}><span>{busy?'CONNECTING…':mode==='create'?'CREATE ROOM':'JOIN ROOM'}</span><span>↗</span></button><div className="entry-foot"><span>◉ 2–8 PLAYERS</span><span>◷ 03:00</span><span>✦ FREE TO PLAY</span></div>{!configured&&<div className="setup-note">Multiplayer activates when Firebase config is added.</div>}</div></div></section>
}
