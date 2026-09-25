"""VOIDFORGE Pixel online room server. aiohttp + authoritative, fixed-tick simulation."""
import asyncio, json, math, os, random, secrets, string, time, sqlite3, hashlib, hmac, re, uuid, contextlib
from aiohttp import web, WSMsgType

PORT = int(os.environ.get('PORT', '8765'))
HOST = os.environ.get('HOST','0.0.0.0')
ALLOWED_ORIGINS = {x.strip() for x in os.environ.get('ALLOWED_ORIGINS','').split(',') if x.strip()}
ROOMS = {}
MODES = {'endless1':(1,'pve'), 'endless2':(2,'pve'), 'endless3':(3,'pve'), 'endless4':(4,'pve'), 'duel':(2,'pvp'), 'teams':(4,'pvp')}
MAX_ROOMS = 150
SPEED = {'gunner':170, 'duelist':188,'brute':143,'arcanist':168}
HEALTH = {'gunner':125,'duelist':135,'brute':205,'arcanist':112}
DAMAGE = {'gunner':16,'duelist':23,'brute':34,'arcanist':21}
RATE = {'gunner':0.16,'duelist':0.32,'brute':0.53,'arcanist':0.28}
ABILITIES = {
 'gunner': {'rail','mortar','slide','phase','sentry','mine','orbital','overclock'},
 'duelist': {'lunge','crescent','shadowstep','chainstep','riposte','mark','thousand','echo'},
 'brute': {'earthsplit','grapple','charge','vault','bastion','warcry','cataclysm','titan'},
 'arcanist': {'chain','well','blink','drift','nova','sigil','supernova','singularity'}
}
COOLDOWN = {'rail':3,'mortar':5,'slide':5,'phase':7,'sentry':11,'mine':7,'orbital':19,'overclock':19,
 'lunge':4,'crescent':5,'shadowstep':6,'chainstep':7,'riposte':9,'mark':7,'thousand':20,'echo':18,
 'earthsplit':5,'grapple':6,'charge':6,'vault':8,'bastion':11,'warcry':11,'cataclysm':21,'titan':24,
 'chain':4,'well':8,'blink':7,'drift':8,'nova':8,'sigil':11,'supernova':20,'singularity':23}
ITEMS = ['power','tempo','vigor','speed','crit','shield','echo','shock','heal','armor','cleave','cooldown']
ENEMY_REGISTRY = {
    'scrapper': {'hp': 36, 'speed': 82, 'atk': 8, 'r': 12, 'role': 'chase', 'tier': 1},
    'seeker': {'hp': 48, 'speed': 66, 'atk': 10, 'r': 12, 'role': 'shot', 'tier': 1},
    'bulwark': {'hp': 128, 'speed': 45, 'atk': 20, 'r': 17, 'role': 'tank', 'tier': 2},
    'ravager': {'hp': 78, 'speed': 100, 'atk': 12, 'r': 13, 'role': 'chase', 'tier': 1},
    'hexcaller': {'hp': 62, 'speed': 51, 'atk': 13, 'r': 12, 'role': 'fan', 'tier': 2},
    'conduit': {'hp': 65, 'speed': 54, 'atk': 6, 'r': 12, 'role': 'healer', 'tier': 2},
    'skitter': {'hp': 28, 'speed': 136, 'atk': 6, 'r': 9, 'role': 'swarm', 'tier': 1},
    'razorbot': {'hp': 53, 'speed': 116, 'atk': 13, 'r': 11, 'role': 'leap', 'tier': 2},
    'arcdrone': {'hp': 47, 'speed': 81, 'atk': 11, 'r': 12, 'role': 'fan', 'tier': 2},
    'missilebot': {'hp': 73, 'speed': 63, 'atk': 15, 'r': 14, 'role': 'mortar', 'tier': 3},
    'sniperbot': {'hp': 50, 'speed': 47, 'atk': 21, 'r': 11, 'role': 'sniper', 'tier': 3},
    'shieldbot': {'hp': 142, 'speed': 40, 'atk': 16, 'r': 18, 'role': 'tank', 'tier': 3},
    'medicbot': {'hp': 67, 'speed': 57, 'atk': 8, 'r': 12, 'role': 'healer', 'tier': 3},
    'flamebot': {'hp': 92, 'speed': 73, 'atk': 15, 'r': 15, 'role': 'flamer', 'tier': 4},
    'cryobot': {'hp': 79, 'speed': 66, 'atk': 12, 'r': 14, 'role': 'freeze', 'tier': 4},
    'railbot': {'hp': 88, 'speed': 42, 'atk': 26, 'r': 14, 'role': 'sniper', 'tier': 5},
    'crusherbot': {'hp': 175, 'speed': 50, 'atk': 26, 'r': 20, 'role': 'charger', 'tier': 5},
    'harvesterbot': {'hp': 85, 'speed': 68, 'atk': 14, 'r': 16, 'role': 'summoner', 'tier': 5},
    'clawling': {'hp': 38, 'speed': 108, 'atk': 9, 'r': 10, 'role': 'swarm', 'tier': 1},
    'leaper': {'hp': 63, 'speed': 117, 'atk': 14, 'r': 12, 'role': 'leap', 'tier': 2},
    'spitter': {'hp': 59, 'speed': 69, 'atk': 12, 'r': 12, 'role': 'shot', 'tier': 2},
    'warper': {'hp': 69, 'speed': 83, 'atk': 15, 'r': 13, 'role': 'teleport', 'tier': 3},
    'voidling': {'hp': 42, 'speed': 106, 'atk': 11, 'r': 11, 'role': 'swarm', 'tier': 3},
    'crystalbrute': {'hp': 161, 'speed': 47, 'atk': 27, 'r': 20, 'role': 'tank', 'tier': 4},
    'siphoner': {'hp': 79, 'speed': 82, 'atk': 13, 'r': 14, 'role': 'leech', 'tier': 4},
    'broodmother': {'hp': 130, 'speed': 51, 'atk': 17, 'r': 19, 'role': 'summoner', 'tier': 5},
    'shadowstalker': {'hp': 75, 'speed': 135, 'atk': 19, 'r': 12, 'role': 'teleport', 'tier': 5},
    'riftseer': {'hp': 87, 'speed': 59, 'atk': 20, 'r': 15, 'role': 'fan', 'tier': 6},
    'phaseling': {'hp': 49, 'speed': 128, 'atk': 14, 'r': 11, 'role': 'teleport', 'tier': 6},
    'detonator': {'hp': 66, 'speed': 104, 'atk': 27, 'r': 12, 'role': 'bomber', 'tier': 6},
    'boss': {'hp': 2500, 'speed': 44, 'atk': 24, 'r': 33, 'role': 'boss', 'tier': 1},
    'colossus': {'hp': 4100, 'speed': 36, 'atk': 32, 'r': 45, 'role': 'boss', 'tier': 1},
    'matriarch': {'hp': 3600, 'speed': 62, 'atk': 29, 'r': 41, 'role': 'boss', 'tier': 1},
    'seraph': {'hp': 4800, 'speed': 74, 'atk': 34, 'r': 37, 'role': 'boss', 'tier': 1},
}
BOSS_TYPES = ['boss','colossus','matriarch','seraph']

ARENA_W, ARENA_H = 1100, 780
# Rectangular walls are shared by client and server. Central arena has multiple entry routes.
WALLS = [(50,50,1000,17),(50,713,1000,17),(50,50,17,680),(1033,50,17,680),
         (265,220,92,30),(740,220,92,30),(265,515,92,30),(740,515,92,30),
         (508,117,84,29),(508,634,84,29)]

def num(v, fallback=0, low=-1e6, high=1e6):
    try:
        n = float(v)
        return max(low,min(high,n)) if math.isfinite(n) else fallback
    except (ValueError, TypeError, OverflowError): return fallback

def circle_rect(x,y,r,rect):
    a,b,w,h=rect
    return (x-max(a,min(a+w,x)))**2+(y-max(b,min(b+h,y)))**2 < r*r

def solid(x,y,r=11):
    return x<69+r or y<69+r or x>1031-r or y>711-r or any(circle_rect(x,y,r,z) for z in WALLS)

def choose_pos(rng, near=None):
    for i in range(100):
        if near:
            a=rng.random()*math.tau; d=rng.uniform(145,280); x=near[0]+math.cos(a)*d;y=near[1]+math.sin(a)*d
        else: x=rng.uniform(100,1000);y=rng.uniform(100,680)
        if not solid(x,y,18):return round(x,2),round(y,2)
    return 550,390

# Persistent account/gear layer. Store DB on a persistent disk or hosted database in production.
DB_PATH=os.environ.get('VF_DB_PATH','voidforge_accounts.sqlite3')
CONN=sqlite3.connect(DB_PATH,isolation_level=None,check_same_thread=False)
CONN.row_factory=sqlite3.Row
CONN.execute('PRAGMA busy_timeout=6000')
CONN.execute('PRAGMA journal_mode=WAL')
CONN.executescript("""
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE NOT NULL, salt TEXT NOT NULL, pw_hash TEXT NOT NULL, gold INTEGER NOT NULL DEFAULT 400, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, uid INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gear(id TEXT PRIMARY KEY, owner INTEGER NOT NULL, class_id TEXT NOT NULL, slot TEXT NOT NULL, rarity TEXT NOT NULL, set_name TEXT, name TEXT NOT NULL, stats TEXT NOT NULL, enchant INTEGER NOT NULL DEFAULT 0, equipped INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
""")
if 'profile_data' not in [r[1] for r in CONN.execute('PRAGMA table_info(users)')]:CONN.execute("ALTER TABLE users ADD COLUMN profile_data TEXT DEFAULT '{}'")
AUTHED={}   # one connected session per user, for live lobby and trading
TRADES={}
LOGIN_FAIL={}
RARITIES=['Common','Uncommon','Rare','Epic','Legendary','Mythic','Ascendant']
SLOTS=['weapon','helm','armor','relic']
SETS={
 'gunner':['Horizon Hunter','Starfall Arsenal','Null Ranger','Aether Command'],
 'duelist':['Rift Dancer','Midnight Fang','Phantom Edge','Spectral Tempest'],
 'brute':['Worldbreaker','Iron Dominion','Obsidian Colossus','Meteorborn'],
 'arcanist':['Astral Choir','Eventide Oracle','Stormweaver','Void Scholar']
}
PREFIX={'weapon':['Rending','Chromatic','Overclocked','Voltaic'], 'helm':['Oracle','Circuit','Specter','Vanguard'], 'armor':['Bastion','Reactive','Riftwoven','Titan'], 'relic':['Nexus','Vortex','Luminous','Abyssal']}
BASE_STAT={'weapon':'damage','helm':'crit','armor':'hp','relic':'cooldown'}
def pw_derive(password,salt):
 return hashlib.pbkdf2_hmac('sha256',password.encode('utf8'),bytes.fromhex(salt),360000).hex()
def valid_name(s):return bool(isinstance(s,str) and re.fullmatch(r'[A-Za-z0-9_]{3,18}',s))
def user_row(uid):return CONN.execute('SELECT id,name,gold FROM users WHERE id=?',(uid,)).fetchone()
def owned_gear(uid):
 return [dict(r,stats=json.loads(r['stats'])) for r in CONN.execute('SELECT * FROM gear WHERE owner=? ORDER BY equipped DESC, created DESC',(uid,)).fetchall()]
def account_packet(uid):
 u=user_row(uid)
 return {'type':'account','name':u['name'],'gold':u['gold'],'inventory':owned_gear(uid),'sets':SETS,'rarities':RARITIES,'profile':json.loads(CONN.execute('SELECT profile_data FROM users WHERE id=?',(uid,)).fetchone()[0] or '{}'),'online':[v['name'] for k,v in AUTHED.items() if k!=uid]}
async def push_account(uid):
 v=AUTHED.get(uid)
 if v and not v['ws'].closed:await v['ws'].send_json(account_packet(uid))
async def push_population():
 users=[v['name'] for v in AUTHED.values()]
 await asyncio.gather(*(v['ws'].send_json({'type':'population','online':users}) for v in AUTHED.values() if not v['ws'].closed),return_exceptions=True)
def make_gear(uid,cls,rarity=None):
 cls=cls if cls in SETS else 'gunner'
 rarity=rarity or random.choices(RARITIES,[38,27,17,10,5,2.4,.6])[0]
 slot=random.choice(SLOTS)
 set_name=random.choice(SETS[cls]) if rarity in ('Epic','Legendary','Mythic','Ascendant') else None
 grade=RARITIES.index(rarity)
 stat=BASE_STAT[slot];power=[2,4,7,10,14,19,25][grade]
 extra=random.choice(['crit','hp','rate','cooldown','damage'])
 stats={stat:power,extra:power//2+1}
 if stat==extra:stats[stat]=power+power//2+1
 name=(set_name+' '+slot.title()) if set_name else (rarity+' '+random.choice(PREFIX[slot])+' '+slot.title())
 obj={'id':uuid.uuid4().hex[:16], 'class_id':cls,'slot':slot,'rarity':rarity,'set_name':set_name,'name':name,'stats':stats,'enchant':0,'equipped':0}
 CONN.execute('INSERT INTO gear(id,owner,class_id,slot,rarity,set_name,name,stats,enchant,equipped,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
 (obj['id'],uid,cls,slot,rarity,set_name,obj['name'],json.dumps(stats),0,0,int(time.time())))
 return obj

def award_gold(uid,amount):
 if uid is not None:CONN.execute('UPDATE users SET gold=MIN(2000000000,gold+?) WHERE id=?',(max(0,int(amount)),uid))
def equip_stats(uid,cls):
 result={'damage':0,'hp':0,'crit':0,'rate':0,'cooldown':0};sets={}
 for g in owned_gear(uid):
  if not g['equipped'] or g['class_id']!=cls:continue
  for k,v in g['stats'].items():
   if k in result:result[k]+=v
  if g['set_name']:sets[g['set_name']]=sets.get(g['set_name'],0)+1
 for n in sets.values():
  if n>=2:result['damage']+=6
  if n>=4:result['hp']+=15;result['crit']+=5
 return result

def trade_snapshot(t):
 names={}
 for uid,offer in t['offers'].items():
  row=CONN.execute('SELECT name FROM gear WHERE id=?',(offer['item'],)).fetchone() if offer['item'] else None
  names[uid]=row['name'] if row else None
 return {'type':'trade_state','with':t['names'],'offers':t['offers'],'accepted':t['accepted'],'itemNames':names}
async def trade_push(t):
 for uid in t['members']:
  v=AUTHED.get(uid)
  if v:await v['ws'].send_json({**trade_snapshot(t),'self':str(uid)})
async def trade_cancel(uid,msg='Trade cancelled'):
 t=TRADES.get(uid)
 if not t:return
 for who in t['members']:
  TRADES.pop(who,None)
  v=AUTHED.get(who)
  if v and not v['ws'].closed:
   try:await v['ws'].send_json({'type':'trade_closed','message':msg})
   except (ConnectionResetError, RuntimeError):pass
async def trade_message(uid,data):
 kind=data['type']
 if kind=='trade_invite':
  target=next((j for j,v in AUTHED.items() if v['name'].casefold()==str(data.get('name','')).casefold()),None)
  if target is None or target==uid or uid in TRADES or target in TRADES:raise ValueError('Player offline, busy, or invalid')
  members=(uid,target)
  t={'members':members,'names':[AUTHED[u]['name'] for u in members],'offers':{str(u):{'item':None,'gold':0} for u in members},'accepted':{str(u):False for u in members}}
  TRADES[uid]=TRADES[target]=t
  await trade_push(t)
 elif kind=='trade_cancel':await trade_cancel(uid)
 else:
  t=TRADES.get(uid)
  if not t:raise ValueError('No trade is open')
  entry=t['offers'][str(uid)]
  if kind=='trade_offer':
   gid=data.get('item');gold=data.get('gold',0)
   if gid is not None:
    r=CONN.execute('SELECT * FROM gear WHERE id=? AND owner=? AND equipped=0',(str(gid),uid)).fetchone()
    if not r:raise ValueError('Cannot trade item: not owned or equipped')
   if type(gold)!=int or not 0<=gold<=user_row(uid)['gold']:raise ValueError('Invalid gold offer')
   entry.update(item=gid,gold=gold)
   t['accepted']={str(i):False for i in t['members']}
   await trade_push(t)
  elif kind=='trade_accept':
   t['accepted'][str(uid)]=True
   if not all(t['accepted'].values()):await trade_push(t);return
   a,b=t['members'];oa,ob=t['offers'][str(a)],t['offers'][str(b)]
   try:
    CONN.execute('BEGIN IMMEDIATE')
    for who,offer in ((a,oa),(b,ob)):
     if user_row(who)['gold']<offer['gold']:raise ValueError('Gold changed. Trade rejected')
     if offer['item'] and not CONN.execute('SELECT 1 FROM gear WHERE id=? AND owner=? AND equipped=0',(offer['item'],who)).fetchone():raise ValueError('Item changed. Trade rejected')
    for sender,recipient,offer in ((a,b,oa),(b,a,ob)):
     if offer['gold']:
      CONN.execute('UPDATE users SET gold=gold-? WHERE id=?',(offer['gold'],sender))
      CONN.execute('UPDATE users SET gold=gold+? WHERE id=?',(offer['gold'],recipient))
     if offer['item']:CONN.execute('UPDATE gear SET owner=? WHERE id=? AND owner=?',(recipient,offer['item'],sender))
    CONN.execute('COMMIT')
   except Exception:
    CONN.execute('ROLLBACK');t['accepted']={str(i):False for i in t['members']};await trade_push(t);raise
   await trade_cancel(uid,'Trade completed!');await push_account(a);await push_account(b)

class Enemy(dict):
    def __getattr__(self, key): return self[key]

class Player:
    def __init__(self, pid, ws, name, cls, uid=None):
        self.id=pid;self.ws=ws;self.name=name[:18];self.cls=cls;self.uid=uid;self.gear={};self.team=0;self.ready=False;self.x=550;self.y=390
        self.hp=self.max_hp=HEALTH[cls];self.shield=0;self.alive=True;self.angle=0;self.seq=0
        self.cmd={'dx':0,'dy':0,'angle':0,'shoot':False,'dash':False,'q':False,'e':False,'r':False}
        self.last_move=(0,-1);self.loadout=[];self.cd={};self.last_shot=0;self.last_dash=0;self.invul_until=0
        self.dmg=0;self.kills=0;self.deaths=0;self.highest=0;self.level=1;self.xp=0;self.items={};self.choice=[];self.crit=0
    def snapshot(self,now):
        return {'id':self.id,'name':self.name,'cls':self.cls,'team':self.team,'ready':self.ready,'x':round(self.x,1),
          'y':round(self.y,1),'angle':round(self.angle,3),'hp':round(self.hp,1),'maxHp':self.max_hp,'shield':round(self.shield,1),
          'alive':self.alive,'score':round(self.dmg),'kills':self.kills,'deaths':self.deaths,'highest':round(self.highest),
          'level':self.level,'xp':self.xp,'items':self.items,'gear':self.gear,'choices':self.choice,
          'cd':{k:round(max(0,v-now),1) for k,v in self.cd.items()},'dashCD':round(max(0,self.last_dash+4.5-now),1),'loadout':self.loadout}

class Room:
    def __init__(self, code, mode, host):
        self.code=code;self.mode=mode;self.capacity,self.kind=MODES[mode];self.players={host.id:host};self.host=host.id
        self.state='lobby';self.started=0;self.round=0;self.wins=[0,0];self.next_round=0;self.enemies={};self.events=[]
        self.seq=0;self.last=time.monotonic();self.broadcast=0;self.spawn=0;self.next_boss=110;self.rng=random.Random(secrets.randbits(64))
        self.rewarded=False;self.last_activity=time.monotonic();self.task=None;self.score=0;self.wave=1;self.wave_mult=1.;self.wave_floor=1.;self.wave_quota=13;self.wave_spawned=0;self.wave_killed=0;self.wave_started=0;self.wave_transition=0;self.wave_clear=0;self.wave_target=0;self.wave_previous=1.;self.boss_mark=1500;self.boss_count=0;self.hazards=[]
    def assign_teams(self):
        for i,p in enumerate(self.players.values()):p.team=(i%2 if self.kind=='pvp' else 0)
    def packet(self,now):
        return {'type':'state','code':self.code,'mode':self.mode,'phase':self.state,'host':self.host,'round':self.round,
                'wins':self.wins,'time':round(max(0,now-self.started),1) if self.state!='lobby' else 0,
                'capacity':self.capacity,'players':[p.snapshot(now) for p in self.players.values()],
                'enemies':[{'id':e['id'],'kind':e['kind'],'x':round(e['x'],1),'y':round(e['y'],1),
                   'hp':round(e['hp'],1),'maxHp':round(e['maxHp'],1),'elite':e['elite']} for e in self.enemies.values()],
                'events':self.events[-45:],'score':round(self.score),
                'wave':({'number':self.wave,'quota':self.wave_quota,'spawned':self.wave_spawned,'killed':self.wave_killed,'mult':self.wave_mult,'floor':self.wave_floor,'clear':self.wave_clear,'target':self.wave_target,'previous':self.wave_previous,'transition':round(max(0,self.wave_transition-now),2),'nextBoss':self.boss_mark} if self.kind=='pve' else None)}
    async def send(self, p, payload):
        if not p.ws.closed:
            try:await p.ws.send_json(payload)
            except (ConnectionResetError,RuntimeError):pass
    async def everyone(self,payload):
        await asyncio.gather(*(self.send(p,payload) for p in list(self.players.values())),return_exceptions=True)
    def event(self,kind,x,y,**extra):
        self.seq+=1;self.events.append({'id':self.seq,'kind':kind,'x':round(x,1),'y':round(y,1),**extra})
        if len(self.events)>45:self.events=self.events[-45:]
    def begin(self,now):
        self.assign_teams();self.state='playing';self.started=now;self.round=1;self.wins=[0,0];self.score=0;self.enemies.clear();self.events.clear();self.spawn=now+.5;self.boss_mark=1500;self.boss_count=0;self.hazards=[];self.wave=1;self.wave_mult=1.;self.wave_floor=1.;self.wave_quota=13;self.wave_spawned=0;self.wave_killed=0;self.wave_started=now;self.wave_transition=0
        self.prepare_round(now)
    def prepare_round(self,now):
        self.enemies.clear();self.next_round=now+1.6
        starts=[(170,390),(930,390),(170,310),(930,470)]
        left=right=0
        for p in self.players.values():
            if self.kind=='pvp':
                idx=left if p.team==0 else right
                if p.team==0:left+=1
                else:right+=1
                p.x,p.y= (170,330+idx*120) if p.team==0 else (930,330+idx*120)
            else:p.x,p.y=choose_pos(self.rng, (550,390))
            p.gear=equip_stats(p.uid,p.cls) if p.uid else {};p.hp=p.max_hp=HEALTH[p.cls]*(1+p.gear.get('hp',0)*.01);p.shield=0;p.alive=True;p.cd.clear();p.last_shot=now;p.last_dash=now-10;p.invul_until=now+1.0
            if self.kind=='pve':p.dmg=0;p.kills=0;p.deaths=0;p.level=1;p.xp=0;p.items={};p.choice=[];p.highest=0
        self.event('round',550,390,num=self.round)
    def hit(self,target,attacker,raw,now,kind='hit'):
        if not target.alive or now<target.invul_until:return 0
        if isinstance(target,Player):
            if attacker and attacker.id==target.id:return 0
            if attacker and attacker.team==target.team:return 0
        amount=max(0,raw)
        if attacker:
            amount*=1+min(1.5,attacker.items.get('power',0)*.12)+min(.6,attacker.gear.get('damage',0)*.008)
            if self.rng.random()<min(.5,attacker.items.get('crit',0)*.05):amount*=1.7;attacker.crit+=1
        if isinstance(target,Player):
            amount*=max(.65,1-.04*target.items.get('armor',0));take=min(target.shield,amount);target.shield-=take;amount-=take
        dealt=min(target.hp,amount)
        target.hp-=dealt
        if attacker:
            attacker.dmg+=dealt;attacker.highest=max(attacker.highest,dealt)
            if self.kind=='pve':self.score+=dealt
        if target.hp<=0:
            target.hp=0;target.alive=False
            if attacker:attacker.kills+=1
            if isinstance(target,Player):target.deaths+=1;self.event('ko',target.x,target.y,name=target.name)
        self.event(kind,target.x,target.y,amount=round(dealt,1),team=attacker.team if attacker else -1)
        return dealt
    def hurt_enemy(self,e,p,raw,now):
        if e['hp']<=0:return 0
        amount=max(1,raw)*(1+min(1.5,p.items.get('power',0)*.12)+min(.6,p.gear.get('damage',0)*.008));critical=self.rng.random()<min(.5,p.items.get('crit',0)*.05)
        if critical:amount*=1.7;p.crit+=1
        dealt=min(e['hp'],amount);e['hp']-=dealt;p.dmg+=dealt;self.score+=dealt;p.highest=max(p.highest,dealt)
        self.event('hit',e['x'],e['y'],amount=round(dealt,1),team=0)
        if e['hp']<=0:
            self.enemies.pop(e['id'],None);p.kills+=1;p.xp+=10 if e['kind']!='boss' else 150
            if p.uid:
                award_gold(p.uid,70 if ENEMY_REGISTRY[e['kind']]['role']=='boss' else (12 if e['elite'] else 2))
                if p.kills%12==0:asyncio.create_task(push_account(p.uid))
                if ENEMY_REGISTRY[e['kind']]['role']=='boss' or self.rng.random()<(.08 if e['elite'] else .012):
                    if len(owned_gear(p.uid))<160:make_gear(p.uid,p.cls,'Legendary' if ENEMY_REGISTRY[e['kind']]['role']=='boss' else None)
                    asyncio.create_task(push_account(p.uid))
            if ENEMY_REGISTRY[e['kind']]['role']=='boss':self.boss_count+=1;self.event('bossdown',e['x'],e['y'],name=e['kind'])
            elif e.get('wave')==self.wave:self.wave_killed+=1
            if p.xp>=int(35*1.3**(p.level-1)):
                p.xp=0;p.level+=1;pool=[x for x in ITEMS if p.items.get(x,0)<8];p.choice=self.rng.sample(pool,min(3,len(pool)))
                self.event('level',p.x,p.y,player=p.id)
        return dealt
    def targets(self,p,enemy=False):
        if self.kind=='pvp':return [q for q in self.players.values() if q.id!=p.id and q.team!=p.team and q.alive]
        return [e for e in self.enemies.values() if e['hp']>0]
    def splash(self,p,x,y,r,power,now,tag='burst'):
        self.event(tag,x,y,r=r,team=p.team)
        for t in list(self.targets(p)):
            if math.hypot(t.x-x,t.y-y)<=r+(t.r if not isinstance(t,Player) else 11):
                (self.hit(t,p,power,now) if isinstance(t,Player) else self.hurt_enemy(t,p,power,now))
    def nearest(self,p,r=400):
        targets=self.targets(p);return min((x for x in targets if math.hypot(x.x-p.x,x.y-p.y)<r),key=lambda x:math.hypot(x.x-p.x,x.y-p.y),default=None)
    def basic(self,p,now):
        if now-p.last_shot < RATE[p.cls]/(1+.09*p.items.get('tempo',0)):return
        p.last_shot=now;power=DAMAGE[p.cls]
        if p.cls in ('duelist','brute'):
            radius=49 if p.cls=='duelist' else 61;half=.85 if p.cls=='duelist' else 1.2
            self.event('swing',p.x,p.y,angle=p.angle,r=radius,team=p.team)
            for t in list(self.targets(p)):
                d=math.hypot(t.x-p.x,t.y-p.y)
                if d>radius+(11 if isinstance(t,Player) else t.r):continue
                a=math.atan2(t.y-p.y,t.x-p.x)
                if abs((a-p.angle+math.pi)%(math.tau)-math.pi)>half:continue
                (self.hit(t,p,power,now) if isinstance(t,Player) else self.hurt_enemy(t,p,power,now))
        else:
            dx,dy=math.cos(p.angle),math.sin(p.angle); self.event('shot',p.x,p.y,angle=p.angle,team=p.team)
            best=None;best_proj=450
            for t in self.targets(p):
                vx,vy=t.x-p.x,t.y-p.y;proj=vx*dx+vy*dy;perp=abs(vx*dy-vy*dx)
                if 0<proj<best_proj and perp<(11 if isinstance(t,Player) else t.r)+5:
                    best=t;best_proj=proj
            if best:(self.hit(best,p,power,now) if isinstance(best,Player) else self.hurt_enemy(best,p,power,now))
    def cast(self,p,slot,now):
        idx={'q':0,'e':1,'r':2}[slot]
        if idx>=len(p.loadout):return
        ability=p.loadout[idx];if_cd=p.cd.get(ability,0)
        if if_cd>now:return
        p.cd[ability]=now+COOLDOWN.get(ability,7)*max(.60,1-p.items.get('cooldown',0)*.06)
        forward=(math.cos(p.angle),math.sin(p.angle));px=p.x+forward[0]*68;py=p.y+forward[1]*68
        power=DAMAGE[p.cls]
        if ability in {'rail','lunge','earthsplit','chain'}:
            if ability=='lunge':self.move_dash(p,forward,92,now)
            if ability=='chain':
                targets=sorted(self.targets(p),key=lambda t:math.hypot(t.x-p.x,t.y-p.y))[:5]
                for n,t in enumerate(targets):
                    if math.hypot(t.x-p.x,t.y-p.y)>270:continue
                    (self.hit(t,p,power*(1.9-.2*n),now) if isinstance(t,Player) else self.hurt_enemy(t,p,power*(1.9-.2*n),now))
                    self.event('bolt',t.x,t.y,team=p.team)
            else:
                for t in list(self.targets(p)):
                    vx,vy=t.x-p.x,t.y-p.y;proj=vx*forward[0]+vy*forward[1];perp=abs(vx*forward[1]-vy*forward[0]);r=13 if isinstance(t,Player) else t.r
                    if 0<proj<220 and perp<r+22:
                        (self.hit(t,p,power*2.4,now) if isinstance(t,Player) else self.hurt_enemy(t,p,power*2.4,now))
                self.event('beam',p.x,p.y,angle=p.angle,r=220,team=p.team)
        elif ability in {'mortar','crescent','well','grapple','nova','supernova','singularity','orbital','cataclysm','thousand'}:
            dist={'mortar':115,'well':125,'orbital':150,'supernova':145,'singularity':135,'grapple':105}.get(ability,65)
            x,y=p.x+forward[0]*dist,p.y+forward[1]*dist
            radius={'crescent':95,'nova':115,'supernova':135,'singularity':145,'orbital':125,'cataclysm':125,'thousand':100,'grapple':55}.get(ability,76)
            mul={'supernova':5,'singularity':4.4,'orbital':4.6,'cataclysm':4.4,'thousand':4,'mortar':2.6}.get(ability,2.0)
            self.splash(p,x,y,radius,power*mul,now,ability)
        elif ability in {'slide','phase','shadowstep','chainstep','charge','vault','blink','drift'}:
            distance={'slide':100,'phase':145,'shadowstep':120,'chainstep':155,'charge':125,'vault':142,'blink':155,'drift':110}[ability]
            self.move_dash(p,p.last_move,distance,now)
            if ability in {'phase','shadowstep','chainstep','charge','vault'}:self.splash(p,p.x,p.y,63,power*2.4,now,ability)
            self.event('dash',p.x,p.y,team=p.team)
        elif ability in {'sentry','mine','echo'}:
            # Automated strike: distinct targeting shape; these lightweight constructs are server-owned.
            self.event(ability,px,py,team=p.team)
            t=self.nearest(p,300)
            if t:(self.hit(t,p,power*2.5,now) if isinstance(t,Player) else self.hurt_enemy(t,p,power*2.5,now))
        elif ability in {'overclock','mark','riposte','bastion','warcry','titan','sigil'}:
            p.shield=min(110,p.shield+35)
            if ability in {'overclock','warcry','titan','mark'}:self.splash(p,p.x,p.y,87,power*1.5,now,ability)
            self.event('ward',p.x,p.y,team=p.team)
    def move_dash(self,p,d,distance,now):
        for i in range(1,13):
            nx=p.x+d[0]*distance/12;ny=p.y+d[1]*distance/12
            if solid(nx,ny):break
            p.x,p.y=nx,ny
        p.invul_until=now+.16
    def enemy_spawn(self,now,kind=None,at=None,count_for_wave=True):
        if len(self.enemies)>=60:return False
        if kind is None:
            available=[name for name,d in ENEMY_REGISTRY.items() if d['role']!='boss' and d['tier']<=min(6,max(1,(self.wave+1)//2))]
            kind=self.rng.choice(available)
        d=ENEMY_REGISTRY[kind];alive=[p for p in self.players.values() if p.alive]
        if not alive:return False
        target=self.rng.choice(alive)
        x,y=at or choose_pos(self.rng,(target.x,target.y))
        if solid(x,y,d['r']):x,y=choose_pos(self.rng,(target.x,target.y))
        seconds=max(0,now-self.started)
        factor=(1.04**(seconds/24))*(1.028**(max(p.level for p in alive)-1)) *self.wave_mult*(1+.23*(len(self.players)-1))
        boss=d['role']=='boss';elite=not boss and self.wave>1 and self.rng.random()<min(.26,.02+self.wave*.013)
        hp=d['hp']*factor*(2.0 if elite else 1)
        self.seq+=1
        self.enemies[self.seq]=Enemy({'id':self.seq,'x':x,'y':y,'hp':hp,'maxHp':hp,'kind':kind,'elite':elite or boss,'r':d['r'],
            'speed':d['speed']*(1+min(.35,seconds*.0008)),'atk':d['atk']*math.sqrt(factor),'cd':now+1.2,'wave':0 if boss or not count_for_wave else self.wave})
        if boss:self.event('boss',x,y,name=kind,threshold=self.score)
        return True
    def wave_director(self,now):
        if self.wave_transition>0:
            if now<self.wave_transition:return True
            self.wave+=1;self.wave_quota=min(72,9+self.wave*4);self.wave_spawned=0;self.wave_killed=0
            self.wave_started=now;self.wave_transition=0;self.spawn=now+.3
            self.event('wave',550,390,num=self.wave,mult=self.wave_mult)
        if self.score>=self.boss_mark and not any(ENEMY_REGISTRY[e['kind']]['role']=='boss' for e in self.enemies.values()):
            kind=BOSS_TYPES[self.boss_count%len(BOSS_TYPES)]
            if self.enemy_spawn(now,kind):
                mark=self.boss_mark
                self.boss_mark=1500 if mark<1500 else 7000 if mark<7000 else 22000 if mark<22000 else 65000 if mark<65000 else int(mark*2.7)
        if self.wave_spawned<self.wave_quota and now>=self.spawn and len(self.enemies)<60:
            count=min(self.wave_quota-self.wave_spawned,1+self.wave//3,60-len(self.enemies))
            for _ in range(count):
                if self.enemy_spawn(now):self.wave_spawned+=1
            self.spawn=now+max(.2,.75/math.sqrt(self.wave_mult))
        if self.wave_spawned>=self.wave_quota and self.wave_killed>=self.wave_quota and not self.enemies:
            clear=now-self.wave_started;target=16+min(19,self.wave*2.2);old=self.wave_mult
            change=(.43 if clear<target*.55 else .29 if clear<target*.8 else .17 if clear<target else .07 if clear<target*1.24 else -.10 if clear>target*1.8 else 0)
            self.wave_mult=max(self.wave_floor,round(self.wave_mult+change,2))
            self.wave_floor=max(self.wave_floor,math.floor(self.wave_mult*2)/2)
            self.wave_previous=old;self.wave_clear=round(clear,1);self.wave_target=round(target,1)
            self.wave_transition=now+2.5
            self.event('wave_clear',550,390,num=self.wave,mult=self.wave_mult,floor=self.wave_floor,time=self.wave_clear)
            return True
        return False
    def tick_hazards(self,now):
        ready=[h for h in self.hazards if h['at']<=now];self.hazards=[h for h in self.hazards if h['at']>now]
        for h in ready:
            self.event('bossblast',h['x'],h['y'],r=h['r'])
            for p in self.players.values():
                if p.alive and math.hypot(p.x-h['x'],p.y-h['y'])<h['r']+11:self.hit(p,None,h['damage'],now)
    def boss_attack(self,e,target,now):
        kind=e['kind'];d=ENEMY_REGISTRY[kind]
        phase=3 if e['hp']<.4*e['maxHp'] else 2 if e['hp']<.7*e['maxHp'] else 1
        r=39+9*phase if kind!='seraph' else 52
        centers=[(target.x,target.y)]
        if kind=='colossus':centers.extend([(target.x+60,target.y),(target.x-60,target.y)])
        if kind=='matriarch' and len(self.enemies)<57:
            for _ in range(phase):self.enemy_spawn(now,'clawling',count_for_wave=False)
        if kind=='seraph':
            a=self.rng.random()*math.tau
            centers.extend([(target.x+math.cos(a+i*math.tau/4)*65,target.y+math.sin(a+i*math.tau/4)*65) for i in range(4)])
        for x,y in centers:
            x=max(85,min(1015,x));y=max(85,min(695,y))
            self.event('warning',x,y,r=r,name=kind)
            self.hazards.append({'x':x,'y':y,'r':r,'at':now+.82,'damage':e['atk']*(1.05+phase*.12)})
        e['cd']=now+max(.9,2.7-phase*.3)

    def tick(self,now,dt):
        if self.state!='playing':return
        if now<self.next_round:return
        for p in list(self.players.values()):
            if not p.alive:continue
            cmd=p.cmd;vx=num(cmd.get('dx'),0,-1,1);vy=num(cmd.get('dy'),0,-1,1);mag=math.hypot(vx,vy)
            if mag>1:vx/=mag;vy/=mag
            if math.hypot(vx,vy)>.1:p.last_move=(vx,vy)
            speed=SPEED[p.cls]*(1+min(.5,p.items.get('speed',0)*.06));step=speed*dt
            nx=p.x+vx*step
            if not solid(nx,p.y):p.x=nx
            ny=p.y+vy*step
            if not solid(p.x,ny):p.y=ny
            p.angle=num(cmd.get('angle'),0,-10,10)
            if cmd.get('dash') and now>=p.last_dash+4.5:
                p.last_dash=now;d=(vx,vy) if math.hypot(vx,vy)>.1 else p.last_move;self.move_dash(p,d,84,now);self.event('dash',p.x,p.y,team=p.team)
            if cmd.get('shoot'):self.basic(p,now)
            for slot in ('q','e','r'):
                if cmd.get(slot):self.cast(p,slot,now)
        if self.kind=='pvp':
            active=[sum(p.alive and p.team==team for p in self.players.values()) for team in (0,1)]
            if 0 in active:
                winner=0 if active[0]>active[1] else 1
                self.wins[winner]+=1;self.event('win',550,390,team=winner,num=self.round)
                if self.wins[winner]>=3:
                    self.state='finished';self.event('finished',550,390,team=winner)
                else:self.round+=1;self.prepare_round(now)
        else:
            is_transition=self.wave_director(now)
            if not is_transition:
                self.tick_hazards(now)
                for e in list(self.enemies.values()):
                    if e['hp']<=0 or not any(p.alive for p in self.players.values()):continue
                    d=ENEMY_REGISTRY[e['kind']]
                    target=min((p for p in self.players.values() if p.alive),key=lambda p:(p.x-e['x'])**2+(p.y-e['y'])**2)
                    dx,dy=target.x-e['x'],target.y-e['y'];distance=math.hypot(dx,dy)
                    role=d['role'];ranged=role in ('shot','fan','mortar','sniper','flamer','freeze','leech','healer','summoner')
                    min_dist=160 if ranged else (e['r']+17 if role!='boss' else e['r']+35)
                    if distance>min_dist and distance>0:
                        speed=e['speed']*dt;nx=e['x']+dx/distance*speed;ny=e['y']+dy/distance*speed
                        if not solid(nx,e['y'],e['r']):e['x']=nx
                        elif not solid(e['x'],e['y']+speed,e['r']):e['y']+=speed
                        elif not solid(e['x'],e['y']-speed,e['r']):e['y']-=speed
                        if not solid(e['x'],ny,e['r']):e['y']=ny
                    if now>=e['cd']:
                        if role=='boss' and distance<450:self.boss_attack(e,target,now)
                        elif role=='summoner':
                            if len(self.enemies)<58:
                                for _ in range(2):self.enemy_spawn(now,'clawling' if e['kind']=='broodmother' else 'skitter',count_for_wave=False)
                            e['cd']=now+3.3
                        elif role=='healer':
                            for f in self.enemies.values():
                                if math.hypot(e['x']-f['x'],e['y']-f['y'])<105:f['hp']=min(f['maxHp'],f['hp']+e['atk'])
                            self.event('heal',e['x'],e['y'],r=48)
                            e['cd']=now+3
                        elif ranged and distance<335:
                            radius=25 if role!='mortar' else 40
                            self.event('warning',target.x,target.y,r=radius)
                            self.hazards.append({'x':target.x,'y':target.y,'r':radius,'at':now+.55,'damage':e['atk']})
                            e['cd']=now+(2.4 if role=='sniper' else 1.8)
                        elif role in ('teleport','leap','charger') and distance<220:
                            step=65 if role!='teleport' else 90
                            nx=e['x']+dx/max(distance,1)*step;ny=e['y']+dy/max(distance,1)*step
                            if not solid(nx,ny,e['r']):e['x'],e['y']=nx,ny
                            self.event('dash',e['x'],e['y'],team=-1)
                            if math.hypot(target.x-e['x'],target.y-e['y'])<e['r']+17:self.hit(target,None,e['atk']*1.4,now)
                            e['cd']=now+1.7
                        elif distance<e['r']+19:
                            self.hit(target,None,e['atk'],now);e['cd']=now+(1 if role=='swarm' else 1.5)
            if not any(p.alive for p in self.players.values()):self.state='finished';self.event('finished',550,390,team=-1)
    async def grant_completion(self):
        if self.rewarded:return
        self.rewarded=True
        if self.kind!='pve':return
        for p in self.players.values():
            if not p.uid:continue
            earned=max(45,int(p.dmg/100+p.kills*2+self.boss_count*110))
            row=CONN.execute('SELECT profile_data FROM users WHERE id=?',(p.uid,)).fetchone()
            try:data=json.loads(row['profile_data'] or '{}')
            except (TypeError,ValueError):data={}
            classes=data.get('classes')
            if not isinstance(classes,dict):continue
            cls=classes.get(p.cls)
            if not isinstance(cls,dict):continue
            lvl=max(1,min(100,int(cls.get('level',1) or 1)))
            xp=max(0,min(10000000,int(cls.get('xp',0) or 0)))+earned
            while lvl<100 and xp>=round(80+lvl*10+lvl*lvl*.85):
                xp-=round(80+lvl*10+lvl*lvl*.85);lvl+=1
            cls['level']=lvl;cls['xp']=xp
            best=data.setdefault('best',{})
            key='online_'+self.mode+'_'+p.cls
            if isinstance(best,dict):best[key]=max(0,min(2_000_000_000,int(best.get(key,0) or 0)),int(p.dmg))
            CONN.execute('UPDATE users SET profile_data=? WHERE id=?',(json.dumps(data,separators=(',',':')),p.uid))
            try:await p.ws.send_json({'type':'mastery_award','cls':p.cls,'level':lvl,'xp':xp,'earned':earned,'mode':self.mode,'score':round(p.dmg)})
            except (ConnectionResetError, RuntimeError):pass
            await push_account(p.uid)
    async def loop(self):
        try:
            while self.code in ROOMS:
                now=time.monotonic();dt=min(.06,max(.0,now-self.last));self.last=now
                if not self.players or (now-self.last_activity>3600):break
                self.tick(now,dt)
                if self.state=='finished' and not self.rewarded:await self.grant_completion()
                if now-self.broadcast>=.1:
                    self.broadcast=now;await self.everyone(self.packet(now))
                    if self.state=='finished':break
                await asyncio.sleep(.05)
        finally:
            if ROOMS.get(self.code) is self:ROOMS.pop(self.code,None)
            await self.everyone({'type':'closed','message':'Room closed. Create another room to play again.'})

async def socket(request):
    origin=request.headers.get('Origin','')
    if ALLOWED_ORIGINS and origin not in ALLOWED_ORIGINS:
        return web.Response(status=403,text='Origin not permitted')
    ws=web.WebSocketResponse(heartbeat=18,max_msg_size=16384,receive_timeout=90)
    await ws.prepare(request)
    player=None;room=None;last_input=0;uid=None
    try:
        await ws.send_json({'type':'hello','message':'VOIDFORGE multiplayer server connected'})
        async for msg in ws:
            if msg.type!=WSMsgType.TEXT:continue
            try:data=json.loads(msg.data)
            except (ValueError,TypeError):continue
            if not isinstance(data,dict):continue
            typ=data.get('type')
            # Accounts authenticate on the same WebSocket used for lobby and match play.
            if typ in ('register','login','resume') and uid is None:
                try:
                    name=str(data.get('name',''));pwd=data.get('password','')
                    key=request.remote or 'unknown';hits=LOGIN_FAIL.get(key,[]);now=time.monotonic()
                    hits=[v for v in hits if now-v<90];LOGIN_FAIL[key]=hits
                    if len(hits)>=12:raise ValueError('Too many attempts; try again shortly')
                    if typ=='register':
                        if not valid_name(name):raise ValueError('Username: 3-18 letters, numbers, underscores')
                        if not isinstance(pwd,str) or not 10<=len(pwd)<=128:raise ValueError('Password must be 10-128 characters')
                        salt=secrets.token_hex(16)
                        try:
                            CONN.execute('INSERT INTO users(name,salt,pw_hash,created) VALUES(?,?,?,?)',(name,salt,pw_derive(pwd,salt),int(time.time())))
                        except sqlite3.IntegrityError:raise ValueError('Username already exists')
                        row=CONN.execute('SELECT id,name FROM users WHERE name=?',(name,)).fetchone();candidate=row['id']
                        for cls in SETS:make_gear(candidate,cls,'Common')
                    elif typ=='login':
                        row=CONN.execute('SELECT * FROM users WHERE name=?',(name,)).fetchone()
                        if not row or not isinstance(pwd,str) or not hmac.compare_digest(pw_derive(pwd,row['salt']),row['pw_hash']):raise ValueError('Incorrect username or password')
                        candidate=row['id']
                    else:
                        token=str(data.get('token',''))
                        row=CONN.execute('SELECT uid FROM sessions WHERE token_hash=? AND expires>?',(hashlib.sha256(token.encode()).hexdigest(),int(time.time()))).fetchone()
                        if not row:raise ValueError('Session expired. Log in again')
                        candidate=row['uid']
                    if candidate in AUTHED:raise ValueError('Account is already online in another tab')
                    uid=candidate
                    token=secrets.token_urlsafe(32);digest=hashlib.sha256(token.encode()).hexdigest()
                    CONN.execute('INSERT INTO sessions(token_hash,uid,expires) VALUES(?,?,?)',(digest,uid,int(time.time())+86400*14))
                    CONN.execute('DELETE FROM sessions WHERE uid=? AND expires<?',(uid,int(time.time())))
                    AUTHED[uid]={'ws':ws,'name':user_row(uid)['name']}
                    await ws.send_json({'type':'authenticated','token':token})
                    await push_account(uid);await push_population()
                except ValueError as exc:
                    LOGIN_FAIL[key].append(time.monotonic())
                    await ws.send_json({'type':'error','message':str(exc)})
                continue
            if typ=='logout':
                if uid:CONN.execute('DELETE FROM sessions WHERE uid=?',(uid,))
                break
            if uid is None:
                await ws.send_json({'type':'error','message':'Log in to play online.'});continue
            if typ in ('trade_invite','trade_cancel','trade_offer','trade_accept'):
                try:await trade_message(uid,data)
                except ValueError as ex:await ws.send_json({'type':'error','message':str(ex)})
                continue
            if typ=='equip':
                gid=str(data.get('item',''));cls=str(data.get('cls',''))
                row=CONN.execute('SELECT * FROM gear WHERE id=? AND owner=?',(gid,uid)).fetchone()
                if not row or cls!=row['class_id'] or room and room.state=='playing':
                    await ws.send_json({'type':'error','message':'Cannot equip that item now'});continue
                CONN.execute('UPDATE gear SET equipped=0 WHERE owner=? AND class_id=? AND slot=?',(uid,cls,row['slot']))
                CONN.execute('UPDATE gear SET equipped=1 WHERE id=? AND owner=?',(gid,uid))
                await push_account(uid);continue
            if typ=='unequip':
                if room and room.state=='playing':continue
                CONN.execute('UPDATE gear SET equipped=0 WHERE id=? AND owner=?',(str(data.get('item','')),uid))
                await push_account(uid);continue
            if typ=='enchant':
                gid=str(data.get('item',''))
                row=CONN.execute('SELECT * FROM gear WHERE id=? AND owner=?',(gid,uid)).fetchone()
                if not row or row['enchant']>=8 or room and room.state=='playing':
                    await ws.send_json({'type':'error','message':'That gear cannot be enchanted now'});continue
                price=75*(row['enchant']+1)**2
                try:
                    CONN.execute('BEGIN IMMEDIATE')
                    if user_row(uid)['gold']<price:raise ValueError('Not enough gold ('+str(price)+' required)')
                    CONN.execute('UPDATE users SET gold=gold-? WHERE id=?',(price,uid))
                    stats=json.loads(row['stats']);stat=BASE_STAT[row['slot']];stats[stat]=int(stats.get(stat,0))+2+row['enchant']
                    CONN.execute('UPDATE gear SET enchant=enchant+1,stats=? WHERE id=? AND owner=?',(json.dumps(stats),gid,uid))
                    CONN.execute('COMMIT')
                except ValueError as ex:
                    CONN.execute('ROLLBACK');await ws.send_json({'type':'error','message':str(ex)});continue
                except Exception:
                    CONN.execute('ROLLBACK');raise
                await push_account(uid);continue
            if typ=='profile_update':
                snap=data.get('profile')
                if isinstance(snap,dict) and len(json.dumps(snap))<45000:
                    CONN.execute('UPDATE users SET profile_data=? WHERE id=?',(json.dumps(snap,separators=(',',':')),uid))
                continue
            if typ=='account':await push_account(uid);continue
            if typ=='leave':
                if player and room:
                    room.players.pop(player.id,None)
                    if room.players:
                        if room.host==player.id:room.host=next(iter(room.players))
                        room.assign_teams()
                        if room.state=='playing':room.state='finished';room.event('disconnect',550,390)
                        await room.everyone(room.packet(time.monotonic()))
                    else:ROOMS.pop(room.code,None)
                    player=None;room=None
                    await ws.send_json({'type':'room_left'})
                continue
            if typ in ('create','join') and player is None:
                cls=data.get('cls','gunner');cls=cls if cls in SPEED else 'gunner'
                name=user_row(uid)['name']
                if typ=='create':
                    mode=data.get('mode','endless2')
                    if mode not in MODES or len(ROOMS)>=MAX_ROOMS:await ws.send_json({'type':'error','message':'Invalid mode or server full'});continue
                    code=''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6))
                    while code in ROOMS:code=''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6))
                    player=Player(secrets.token_hex(4),ws,name,cls,uid);room=Room(code,mode,player);ROOMS[code]=room;room.task=asyncio.create_task(room.loop())
                else:
                    code=str(data.get('code','')).strip().upper()
                    room=ROOMS.get(code)
                    if not room or room.state!='lobby' or len(room.players)>=room.capacity:
                        await ws.send_json({'type':'error','message':'Room not found, already started, or full'});room=None;continue
                    player=Player(secrets.token_hex(4),ws,name,cls,uid);room.players[player.id]=player
                player.gear=equip_stats(uid,cls);room.assign_teams();room.last_activity=time.monotonic()
                await ws.send_json({'type':'joined','id':player.id,'code':room.code,'mode':room.mode,'capacity':room.capacity})
                await room.everyone(room.packet(time.monotonic()))
                continue
            if not player or not room:continue
            room.last_activity=time.monotonic()
            if typ=='ready' and room.state=='lobby':
                player.ready=bool(data.get('ready',True));await room.everyone(room.packet(time.monotonic()))
            elif typ=='class' and room.state=='lobby':
                if data.get('cls') in SPEED:player.cls=data['cls'];player.gear=equip_stats(uid,player.cls);player.max_hp=player.hp=HEALTH[player.cls]*(1+player.gear.get('hp',0)*.01)
                room.assign_teams();await room.everyone(room.packet(time.monotonic()))
            elif typ=='loadout' and room.state=='lobby':
                # Offline save can't be trusted by server. Validate class/ability membership, not unlocks.
                ids=data.get('ids',[])
                if isinstance(ids,list):player.loadout=[v for v in ids[:3] if v in ABILITIES[player.cls]]
            elif typ=='start' and player.id==room.host and room.state=='lobby':
                if len(room.players)!=room.capacity or not all(p.ready for p in room.players.values()):
                    await room.send(player,{'type':'error','message':'All slots must be filled and ready'});continue
                room.begin(time.monotonic());await room.everyone(room.packet(time.monotonic()))
            elif typ=='input' and room.state=='playing':
                now=time.monotonic()
                if now-last_input<.025:continue
                last_input=now
                player.cmd={k:data.get(k,False) for k in ('shoot','dash','q','e','r')}
                for k in ('dx','dy'):player.cmd[k]=num(data.get(k),0,-1,1)
                player.cmd['angle']=num(data.get('angle'),0,-math.tau*2,math.tau*2)
            elif typ=='pick' and room.kind=='pve':
                choice=str(data.get('item',''))
                if choice in player.choice:
                    player.items[choice]=min(8,player.items.get(choice,0)+1);player.choice=[]
                    player.max_hp=HEALTH[player.cls]+player.items.get('vigor',0)*18
                    if choice=='vigor':player.hp=min(player.max_hp,player.hp+18)
                    if choice=='shield':player.shield=min(100,player.shield+20)
                    await room.send(player,{'type':'picked','item':choice})
    finally:
        if uid:
            await trade_cancel(uid,'Other player disconnected')
            AUTHED.pop(uid,None)
            await push_population()
        if player and room and room.code in ROOMS:
            room.players.pop(player.id,None)
            if room.players:
                if room.host==player.id:room.host=next(iter(room.players))
                room.assign_teams()
                if room.state=='playing':room.state='finished';room.event('disconnect',550,390)
                await room.everyone(room.packet(time.monotonic()))
            else:
                ROOMS.pop(room.code,None)
        await ws.close()
    return ws

async def health(request):return web.json_response({'status':'ok','rooms':len(ROOMS),'version':'pixel-online-0.5-wave'})
app=web.Application()
app.router.add_get('/health',health)
app.router.add_get('/ws',socket)
app.router.add_get('/',health)
if __name__=='__main__':web.run_app(app,host=HOST,port=PORT)
