"""VOIDFORGE Pixel online room server. aiohttp + authoritative, fixed-tick simulation."""
import asyncio, json, math, os, random, secrets, string, time, sqlite3, hashlib, hmac, re, uuid, contextlib
from aiohttp import web, WSMsgType

PORT = int(os.environ.get('PORT', '8765'))
HOST = os.environ.get('HOST','0.0.0.0')
ALLOWED_ORIGINS = {x.strip() for x in os.environ.get('ALLOWED_ORIGINS','').split(',') if x.strip()}
ROOMS = {}
MODES = {'endless2':(2,'pve'), 'endless3':(3,'pve'), 'endless4':(4,'pve'), 'duel':(2,'pvp'), 'teams':(4,'pvp')}
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
ITEMS = ['copper','stride','needle','battery','tempo','leech','spark','burn','frost','shield','blast','echo','orbit','drone','critboom','haste','glass','storm','dashmine','armor',
         'shrapnel','doubletap','targeter','blooddance','specterblade','swiftstep','tremor','jugger','ironwave','flux','riftspark','manashield']
ITEM_CLASS={'shrapnel':'gunner','doubletap':'gunner','targeter':'gunner','blooddance':'duelist','specterblade':'duelist','swiftstep':'duelist','tremor':'brute','jugger':'brute','ironwave':'brute','flux':'arcanist','riftspark':'arcanist','manashield':'arcanist'}
BASIC_ABILITIES={'gunner':{'pulse','scatter'},'duelist':{'slash','chakram'},'brute':{'hammer','flail'},'arcanist':{'bolt','needle'}}
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

ARENA_W, ARENA_H = 1600, 1120
# Same collision rectangles used by the offline Ashen Foundry map.
WALLS = [
 (390,252,56,220),(390,548,56,186),(1136,252,56,220),(1136,548,56,186),
 (575,155,132,38),(895,155,132,38),(575,922,132,38),(895,922,132,38),
 (250,310,84,48),(250,700,84,48),(1230,310,84,48),(1230,700,84,48),
 (520,340,48,54),(1032,340,48,54),(520,740,48,54),(1032,740,48,54),
 (650,260,36,36),(924,260,36,36),(650,826,36,36),(924,826,36,36),
 (170,500,62,60),(1370,520,62,60),
 (615,397,78,23),(905,397,78,23),(615,710,78,23),(905,710,78,23)
]

def num(v, fallback=0, low=-1e6, high=1e6):
    try:
        n = float(v)
        return max(low,min(high,n)) if math.isfinite(n) else fallback
    except (ValueError, TypeError, OverflowError): return fallback

def circle_rect(x,y,r,rect):
    a,b,w,h=rect
    return (x-max(a,min(a+w,x)))**2+(y-max(b,min(b+h,y)))**2 < r*r

def solid(x,y,r=11):
    return x<25+r or y<25+r or x>ARENA_W-25-r or y>ARENA_H-25-r or any(circle_rect(x,y,r+2,z) for z in WALLS)

def segment_hits_wall(x1,y1,x2,y2,r=2):
    # Sample along the swept projectile path so fast bullets cannot tunnel through thin walls.
    d=math.hypot(x2-x1,y2-y1)
    steps=max(1,int(d/5)+1)
    for i in range(1,steps+1):
        t=i/steps
        if solid(x1+(x2-x1)*t,y1+(y2-y1)*t,r):return True
    return False

def hit_radius(obj):
    # Combat hitboxes are deliberately tighter than the art silhouettes.
    if isinstance(obj,Player):return 8.0
    try:return max(6.5,min(15.0,float(obj.get('r',11))*.70))
    except Exception:return 8.0

def choose_pos(rng, near=None):
    for i in range(100):
        if near:
            a=rng.random()*math.tau; d=rng.uniform(145,280); x=near[0]+math.cos(a)*d;y=near[1]+math.sin(a)*d
        else: x=rng.uniform(60,ARENA_W-60);y=rng.uniform(60,ARENA_H-60)
        if not solid(x,y,18):return round(x,2),round(y,2)
    return 800,565

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
GEAR_COLS=[r[1] for r in CONN.execute('PRAGMA table_info(gear)')]
if 'enchant_data' not in GEAR_COLS:CONN.execute("ALTER TABLE gear ADD COLUMN enchant_data TEXT DEFAULT '{}'")
if 'enchant_tier' not in GEAR_COLS:CONN.execute("ALTER TABLE gear ADD COLUMN enchant_tier TEXT DEFAULT ''")
if 'enchant_rolls' not in GEAR_COLS:CONN.execute("ALTER TABLE gear ADD COLUMN enchant_rolls INTEGER DEFAULT 0")
AUTHED={}   # one connected session per user, for live lobby and trading
HUB_PLAYERS={} # uid -> persistent social-lobby avatar state while connected
HUB_W,HUB_H=900,560
TRADES={}
LOGIN_FAIL={}
RARITIES=['Common','Uncommon','Rare','Epic','Legendary','Exotic','Mythic','Ascendant']
SLOTS=['weapon','helm','armor','gloves','boots','relic']
SETS={
 'gunner':['Horizon Hunter','Starfall Arsenal','Null Ranger','Aether Command','Solar Deadeye','Siege Protocol'],
 'duelist':['Rift Dancer','Midnight Fang','Phantom Edge','Spectral Tempest','Glass Viper','Neon Ronin'],
 'brute':['Worldbreaker','Iron Dominion','Obsidian Colossus','Meteorborn','Furnace King','Gravity Breaker'],
 'arcanist':['Astral Choir','Eventide Oracle','Stormweaver','Void Scholar','Nebula Sage','Chrono Weaver']
}
SET_EFFECTS={
 'Horizon Hunter':{2:{'crit':8},4:{'damage':14},6:{'crit':5,'damage':8}},'Starfall Arsenal':{2:{'rate':10},4:{'cooldown':12},6:{'damage':10}},'Null Ranger':{2:{'speed':10},4:{'crit':10,'damage':8},6:{'speed':8,'damage':8}},'Aether Command':{2:{'cooldown':10},4:{'hp':18},6:{'armor':12}},'Solar Deadeye':{2:{'crit':9},4:{'damage':12},6:{'crit':8}},'Siege Protocol':{2:{'damage':12},4:{'armor':15},6:{'cooldown':10}},
 'Rift Dancer':{2:{'speed':10},4:{'rate':16},6:{'damage':10}},'Midnight Fang':{2:{'crit':10},4:{'damage':16},6:{'crit':8}},'Phantom Edge':{2:{'cooldown':10},4:{'damage':12},6:{'speed':10}},'Spectral Tempest':{2:{'hp':12},4:{'speed':12,'crit':6},6:{'damage':10}},'Glass Viper':{2:{'crit':12},4:{'speed':15},6:{'damage':12}},'Neon Ronin':{2:{'damage':10},4:{'cooldown':12},6:{'crit':9}},
 'Worldbreaker':{2:{'damage':10},4:{'damage':18},6:{'cooldown':10}},'Iron Dominion':{2:{'hp':15},4:{'armor':18},6:{'damage':10}},'Obsidian Colossus':{2:{'hp':20},4:{'damage':12},6:{'armor':14}},'Meteorborn':{2:{'cooldown':10},4:{'speed':10,'damage':10},6:{'damage':12}},'Furnace King':{2:{'armor':12},4:{'damage':14},6:{'rate':10}},'Gravity Breaker':{2:{'cooldown':10},4:{'hp':18},6:{'damage':14}},
 'Astral Choir':{2:{'cooldown':10},4:{'crit':10},6:{'damage':11}},'Eventide Oracle':{2:{'damage':10},4:{'cooldown':12},6:{'crit':8}},'Stormweaver':{2:{'rate':12},4:{'damage':14},6:{'crit':8}},'Void Scholar':{2:{'hp':12},4:{'damage':12,'crit':5},6:{'cooldown':10}},'Nebula Sage':{2:{'crit':10},4:{'cooldown':15},6:{'damage':12}},'Chrono Weaver':{2:{'speed':10},4:{'damage':12},6:{'cooldown':12}}
}
PREFIX={'weapon':['Rending','Chromatic','Overclocked','Voltaic','Celestial','Siegeborn'], 'helm':['Oracle','Circuit','Specter','Vanguard','Halo','Aegis'], 'armor':['Bastion','Reactive','Riftwoven','Titan','Nova','Gravitic'], 'gloves':['Striker','Pulse','Riftgrip','Phasebound','Impact','Arc'], 'boots':['Vector','Warp','Comet','Ghost','Riftstep','Kinetic'], 'relic':['Nexus','Vortex','Luminous','Abyssal','Prism','Singularity']}
BASE_STAT={'weapon':'damage','helm':'crit','armor':'hp','gloves':'rate','boots':'speed','relic':'cooldown'}
SELL_VALUES={'Common':10,'Uncommon':24,'Rare':60,'Epic':145,'Legendary':360,'Exotic':700,'Mythic':1250,'Ascendant':2800}
ENCHANT_TIERS=[('Etched',1,1),('Charged',1,2),('Runic',2,2),('Exalted',2,3),('Prismatic',3,3)]
ENCHANT_STATS=['damage','hp','crit','rate','cooldown','speed','armor']
def pw_derive(password,salt):
 return hashlib.pbkdf2_hmac('sha256',password.encode('utf8'),bytes.fromhex(salt),360000).hex()
def valid_name(s):return bool(isinstance(s,str) and re.fullmatch(r'[A-Za-z0-9_]{3,18}',s))
def user_row(uid):return CONN.execute('SELECT id,name,gold FROM users WHERE id=?',(uid,)).fetchone()
def owned_gear(uid):
 out=[]
 for r in CONN.execute('SELECT * FROM gear WHERE owner=? ORDER BY equipped DESC, created DESC',(uid,)).fetchall():
  d=dict(r);d['stats']=json.loads(d.get('stats') or '{}')
  try:d['enchant_data']=json.loads(d.get('enchant_data') or '{}')
  except (ValueError,TypeError):d['enchant_data']={}
  d['enchant_tier']=d.get('enchant_tier') or ''
  d['enchant_rolls']=int(d.get('enchant_rolls') or 0)
  out.append(d)
 return out
def account_packet(uid):
 u=user_row(uid)
 return {'type':'account','name':u['name'],'gold':u['gold'],'inventory':owned_gear(uid),'sets':SETS,'rarities':RARITIES,'profile':json.loads(CONN.execute('SELECT profile_data FROM users WHERE id=?',(uid,)).fetchone()[0] or '{}'),'online':[v['name'] for k,v in AUTHED.items() if k!=uid]}
async def push_account(uid):
 v=AUTHED.get(uid)
 if v and not v['ws'].closed:await v['ws'].send_json(account_packet(uid))
async def push_population():
 users=[v['name'] for v in AUTHED.values()]
 await asyncio.gather(*(v['ws'].send_json({'type':'population','online':users}) for v in AUTHED.values() if not v['ws'].closed),return_exceptions=True)

def hub_packet():
 return {'type':'hub_state','players':[{'uid':uid,'name':AUTHED.get(uid,{}).get('name','Player'),'cls':v.get('cls','gunner'),'x':round(v.get('x',450),1),'y':round(v.get('y',360),1),'angle':round(v.get('angle',0),3),'moving':bool(v.get('moving')),'inMatch':bool(v.get('inMatch')),'look':v.get('look',{})} for uid,v in HUB_PLAYERS.items() if uid in AUTHED]}
async def push_hub():
 packet=hub_packet()
 await asyncio.gather(*(v['ws'].send_json(packet) for v in AUTHED.values() if not v['ws'].closed),return_exceptions=True)
def gear_look(uid,cls):
 inv=owned_gear(uid);eq=[g for g in inv if g['equipped'] and g['class_id']==cls]
 rarity=max((RARITIES.index(g['rarity']) for g in eq),default=0)
 sets={}
 for g in eq:
  if g.get('set_name'):sets[g['set_name']]=sets.get(g['set_name'],0)+1
 best=max(sets,key=sets.get) if sets else ''
 slots={g['slot']:{'rarity':RARITIES.index(g['rarity']) if g['rarity'] in RARITIES else 0,'set':g.get('set_name') or '','name':g['name']} for g in eq}
 return {'rarity':rarity,'set':best,'pieces':sets.get(best,0) if best else 0,'slots':slots}
def hub_solid(x,y):
 # keep the plaza open while preventing players from walking through the four big terminals
 if x<35 or y<35 or x>HUB_W-35 or y>HUB_H-35:return True
 for rx,ry,rw,rh in ((48,58,205,142),(647,58,205,142),(48,360,205,142),(647,360,205,142),(330,430,240,105),(366,208,168,144)):
  if rx-10<x<rx+rw+10 and ry-10<y<ry+rh+10:return True
 return False
def roll_gear_rarity(source='world'):
 # Permanent gear is intentionally much rarer than run augments.
 if source=='boss':
  return random.choices(RARITIES,[0,44,32,16,6,1.6,.35,.05])[0]
 if source=='cache':
  return random.choices(RARITIES,[40,35,17,6,1.7,.25,.045,.005])[0]
 return random.choices(RARITIES,[56,28,10.5,4,1.15,.28,.06,.01])[0]

def make_gear(uid,cls,rarity=None):
 cls=cls if cls in SETS else 'gunner'
 rarity=rarity or roll_gear_rarity('world')
 slot=random.choice(SLOTS)
 set_name=random.choice(SETS[cls]) if rarity in ('Epic','Legendary','Exotic','Mythic','Ascendant') else None
 grade=RARITIES.index(rarity)
 stat=BASE_STAT[slot];power=[2,4,7,10,14,18,23,30][grade]
 extra=random.choice(['crit','hp','rate','cooldown','damage','speed','armor'])
 stats={stat:power,extra:power//2+1}
 if stat==extra:stats[stat]=power+power//2+1
 name=(set_name+' '+slot.title()) if set_name else (rarity+' '+random.choice(PREFIX[slot])+' '+slot.title())
 obj={'id':uuid.uuid4().hex[:16], 'class_id':cls,'slot':slot,'rarity':rarity,'set_name':set_name,'name':name,'stats':stats,'enchant':0,'equipped':0}
 CONN.execute('INSERT INTO gear(id,owner,class_id,slot,rarity,set_name,name,stats,enchant,equipped,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
 (obj['id'],uid,cls,slot,rarity,set_name,obj['name'],json.dumps(stats),0,0,int(time.time())))
 return obj

def enchant_price(row):
 rarity=row['rarity'] if row['rarity'] in RARITIES else 'Common';grade=RARITIES.index(rarity);rolls=int(row['enchant_rolls'] or 0) if 'enchant_rolls' in row.keys() else 0
 return int(round((120+grade*85)*(1+rolls*.55)))
def roll_enchant(row):
 grade=RARITIES.index(row['rarity']) if row['rarity'] in RARITIES else 0
 # Better item rarities improve odds, while every tier still remains random.
 weights=[max(8,48-grade*3),28,15+grade,7+grade*1.4,2+grade*.9]
 tier_i=random.choices(range(5),weights)[0];name,min_aff,max_aff=ENCHANT_TIERS[tier_i];count=random.randint(min_aff,max_aff)
 stats=random.sample(ENCHANT_STATS,count);out={}
 for stat in stats:
  base={'damage':2.2,'hp':5.0,'crit':1.4,'rate':1.8,'cooldown':1.5,'speed':1.7,'armor':2.2}[stat]
  lo=base*(1+tier_i*.58+grade*.16);hi=lo*(1.45+.08*tier_i)
  out[stat]=max(1,int(round(random.uniform(lo,hi))))
 return name,out
def gear_sell_value(row):
 rarity=row['rarity'] if row['rarity'] in SELL_VALUES else 'Common';rolls=int(row['enchant_rolls'] or 0) if 'enchant_rolls' in row.keys() else int(row['enchant'] or 0)
 return int(round(SELL_VALUES[rarity]*(1+.18*rolls)))
def award_gold(uid,amount):
 if uid is not None:CONN.execute('UPDATE users SET gold=MIN(2000000000,gold+?) WHERE id=?',(max(0,int(amount)),uid))
def equip_stats(uid,cls):
 result={'damage':0,'hp':0,'crit':0,'rate':0,'cooldown':0,'speed':0,'armor':0};sets={}
 for g in owned_gear(uid):
  if not g['equipped'] or g['class_id']!=cls:continue
  for k,v in g['stats'].items():
   if k in result:result[k]+=v
  for k,v in (g.get('enchant_data') or {}).items():
   if k in result:result[k]+=v
  if g['set_name']:sets[g['set_name']]=sets.get(g['set_name'],0)+1
 for name,n in sets.items():
  effect=SET_EFFECTS.get(name,{})
  for threshold in (2,4,6):
   if n>=threshold:
    for k,v in effect.get(threshold,{}).items():result[k]=result.get(k,0)+v
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


def load_player_build(p):
 p.perm={'damage':0,'hp':0,'crit':0,'rate':0,'speed':0,'sustain':0,'basic_amp':0,'power_amp':0,'mobility_amp':0,'utility_amp':0,'ultimate_amp':0}
 p.ranks={};p.basic={'gunner':'pulse','duelist':'slash','brute':'hammer','arcanist':'bolt'}[p.cls]
 if not p.uid:return
 row=CONN.execute('SELECT profile_data FROM users WHERE id=?',(p.uid,)).fetchone()
 try:data=json.loads(row['profile_data'] or '{}') if row else {}
 except Exception:data={}
 c=(data.get('classes') or {}).get(p.cls) or {};owned=c.get('owned') or {};load=c.get('loadout') or {}
 p.ranks={str(k):max(0,min(5,int(v or 0))) for k,v in owned.items() if isinstance(k,str)}
 p.basic=load.get('basic') if load.get('basic') in BASIC_ABILITIES[p.cls] and p.ranks.get(load.get('basic'),0)>0 else p.basic
 p.loadout=[v for v in (load.get('skill1'),load.get('skill2'),load.get('skill3')) if v in ABILITIES[p.cls] and p.ranks.get(v,0)>0]
 p.perm['damage']=p.ranks.get('force',0)*.04;p.perm['hp']=p.ranks.get('vital',0)*.05;p.perm['crit']=p.ranks.get('precision',0)*.02
 p.perm['rate']=p.ranks.get('tempo',0)*.04;p.perm['speed']=p.ranks.get('flow',0)*.03;p.perm['sustain']=p.ranks.get('sustain',0)*.014
 for k in ('basic_amp','power_amp','mobility_amp','utility_amp','ultimate_amp'):p.perm[k]=p.ranks.get(k,0)*.13
 # Lightweight Paradigm support: every owned node contributes a small universal bonus. Rare routing still matters client-side.
 para=c.get('paragon') or []
 n=min(90,len(para) if isinstance(para,list) else 0);p.perm['damage']+=n*.0015;p.perm['hp']+=n*.0018;p.perm['speed']+=n*.0008

def item_damage_mult(p):
 return (1+p.perm.get('damage',0))*(1+.12*p.items.get('copper',0))*(1+.50*p.items.get('glass',0))*(1+.07*p.items.get('jugger',0) if p.cls=='brute' else 1)*(1+.06*p.items.get('riftspark',0) if p.cls=='arcanist' else 1)
def item_rate_mult(p):return 1+p.perm.get('rate',0)+.10*p.items.get('tempo',0)
def item_speed_mult(p):return 1+p.perm.get('speed',0)+.07*p.items.get('stride',0)
def item_crit(p):return min(.65,p.perm.get('crit',0)+.05*p.items.get('needle',0))
def item_cooldown_mult(p):return max(.48,1-.06*p.items.get('haste',0)-(.04*p.items.get('riftspark',0) if p.cls=='arcanist' else 0))

class Enemy(dict):
    def __getattr__(self, key): return self[key]

class Player:
    def __init__(self, pid, ws, name, cls, uid=None):
        self.id=pid;self.ws=ws;self.name=name[:18];self.cls=cls;self.uid=uid;self.gear={};self.team=0;self.ready=False;self.x=800;self.y=565
        self.hp=self.max_hp=HEALTH[cls];self.shield=0;self.alive=True;self.angle=0;self.seq=0
        self.cmd={'dx':0,'dy':0,'angle':0,'shoot':False,'dash':False,'q':False,'e':False,'r':False,'revive':False}
        self.last_move=(0,-1);self.loadout=[];self.basic={'gunner':'pulse','duelist':'slash','brute':'hammer','arcanist':'bolt'}[cls];self.cd={};self.last_shot=0;self.last_dash=0;self.invul_until=0
        self.dmg=0;self.kills=0;self.deaths=0;self.highest=0;self.level=1;self.xp=0;self.items={};self.choice=[];self.crit=0;self.ranks={};self.perm={};self.proc=0;self.drone_at=0;self.orbit_at=0;self.downed=False;self.down_until=0;self.revive_progress=0
    def snapshot(self,now):
        return {'id':self.id,'name':self.name,'cls':self.cls,'team':self.team,'ready':self.ready,'x':round(self.x,1),
          'y':round(self.y,1),'angle':round(self.angle,3),'hp':round(self.hp,1),'maxHp':self.max_hp,'shield':round(self.shield,1),
          'alive':self.alive,'downed':self.downed,'revive':round(self.revive_progress,2),'downFor':round(max(0,self.down_until-now),1),'score':round(self.dmg),'kills':self.kills,'deaths':self.deaths,'highest':round(self.highest),
          'level':self.level,'xp':self.xp,'items':self.items,'gear':self.gear,'choices':self.choice,
          'cd':{k:round(max(0,v-now),1) for k,v in self.cd.items()},'dashCD':round(max(0,self.last_dash+4.5-now),1),'loadout':self.loadout,'basic':self.basic,'look':gear_look(self.uid,self.cls) if self.uid else {}}

class Room:
    def __init__(self, code, mode, host):
        self.code=code;self.mode=mode;self.capacity,self.kind=MODES[mode];self.players={host.id:host};self.host=host.id
        self.state='lobby';self.started=0;self.round=0;self.wins=[0,0];self.next_round=0;self.enemies={};self.events=[];self.projectiles={};self.proj_seq=0
        self.seq=0;self.last=time.monotonic();self.broadcast=0;self.spawn=0;self.next_boss=110;self.rng=random.Random(secrets.randbits(64))
        self.rewarded=False;self.last_activity=time.monotonic();self.task=None;self.score=0;self.gear_drops=0;self.gear_pity=0;self.wave=1;self.wave_mult=1.;self.wave_floor=1.;self.wave_quota=13;self.wave_spawned=0;self.wave_killed=0;self.wave_started=0;self.wave_transition=0;self.wave_clear=0;self.wave_target=0;self.wave_previous=1.;self.boss_mark=1500;self.boss_count=0;self.hazards=[]
    def assign_teams(self):
        for i,p in enumerate(self.players.values()):p.team=(i%2 if self.kind=='pvp' else 0)
    def packet(self,now):
        return {'type':'state','code':self.code,'mode':self.mode,'phase':self.state,'host':self.host,'round':self.round,
                'wins':self.wins,'time':round(max(0,now-self.started),1) if self.state!='lobby' else 0,
                'capacity':self.capacity,'players':[p.snapshot(now) for p in self.players.values()],
                'enemies':[{'id':e['id'],'kind':e['kind'],'x':round(e['x'],1),'y':round(e['y'],1),
                   'hp':round(e['hp'],1),'maxHp':round(e['maxHp'],1),'elite':e['elite']} for e in self.enemies.values()],
                'projectiles':[{'id':b['id'],'x':round(b['x'],1),'y':round(b['y'],1),'vx':round(b['vx'],1),'vy':round(b['vy'],1),'r':b['r'],'kind':b['kind'],'team':b['team'],'owner':b['owner']} for b in self.projectiles.values()],
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
        self.assign_teams();self.state='playing';self.started=now;self.round=1;self.wins=[0,0];self.score=0;self.enemies.clear();self.projectiles.clear();self.events.clear();self.spawn=now+.5;self.boss_mark=1500;self.boss_count=0;self.hazards=[];self.wave=1;self.wave_mult=1.;self.wave_floor=1.;self.wave_quota=13;self.wave_spawned=0;self.wave_killed=0;self.wave_started=now;self.wave_transition=0
        self.prepare_round(now)
    def prepare_round(self,now):
        self.enemies.clear();self.projectiles.clear();self.next_round=now+1.6
        starts=[(230,565),(1370,565),(230,420),(1370,710)]
        left=right=0
        for p in self.players.values():
            if self.kind=='pvp':
                idx=left if p.team==0 else right
                if p.team==0:left+=1
                else:right+=1
                p.x,p.y=(230,475+idx*180) if p.team==0 else (1370,475+idx*180)
            else:p.x,p.y=choose_pos(self.rng,(800,565))
            load_player_build(p);p.gear=equip_stats(p.uid,p.cls) if p.uid else {}
            p.max_hp=HEALTH[p.cls]*(1+p.gear.get('hp',0)*.01+p.perm.get('hp',0));p.hp=p.max_hp;p.shield=0;p.alive=True;p.downed=False;p.down_until=0;p.revive_progress=0;p.cd.clear();p.last_shot=now;p.last_dash=now-10;p.invul_until=now+1.0
            if self.kind=='pve':p.dmg=0;p.kills=0;p.deaths=0;p.level=1;p.xp=0;p.items={};p.choice=[];p.highest=0;p.proc=0;p.drone_at=now+1;p.orbit_at=now+1
        self.event('round',800,565,num=self.round)
    def hit(self,target,attacker,raw,now,kind='hit'):
        if not target.alive or now<target.invul_until:return 0
        if isinstance(target,Player):
            if attacker and attacker.id==target.id:return 0
            if attacker and attacker.team==target.team:return 0
        amount=max(0,raw)
        if attacker:
            amount*=item_damage_mult(attacker)*(1+min(.6,attacker.gear.get('damage',0)*.008))
            if self.rng.random()<min(.65,.05+item_crit(attacker)+attacker.gear.get('crit',0)*.003):amount*=1.7;attacker.crit+=1
        if isinstance(target,Player):
            amount*=max(.45,1-.05*target.items.get('armor',0)-target.gear.get('armor',0)*.005);take=min(target.shield,amount);target.shield-=take;amount-=take
        dealt=min(target.hp,amount)
        target.hp-=dealt
        if isinstance(target,Player) and target.cls=='brute' and target.items.get('ironwave') and dealt>0 and self.kind=='pve':self.splash(target,target.x,target.y,55,DAMAGE[target.cls]*(.18+.10*target.items.get('ironwave',0)),now,'nova')
        if attacker:
            attacker.dmg+=dealt;attacker.highest=max(attacker.highest,dealt)
            if self.kind=='pve':self.score+=dealt
        if target.hp<=0:
            target.hp=0
            if isinstance(target,Player):
                can_revive=(self.mode!='duel' and len(self.players)>1)
                if can_revive:
                    target.alive=False;target.downed=True;target.down_until=now+12;target.revive_progress=0
                    self.event('downed',target.x,target.y,name=target.name,team=target.team)
                else:
                    target.alive=False;target.downed=False;target.deaths+=1
                    self.event('ko',target.x,target.y,name=target.name)
            else:
                target.alive=False
            if attacker:attacker.kills+=1
        self.event(kind,target.x,target.y,amount=round(dealt,1),team=attacker.team if attacker else -1)
        return dealt
    def hurt_enemy(self,e,p,raw,now):
        if e['hp']<=0:return 0
        amount=max(1,raw)*item_damage_mult(p)*(1+min(.6,p.gear.get('damage',0)*.008));critical=self.rng.random()<min(.65,.05+item_crit(p)+p.gear.get('crit',0)*.003)
        if ENEMY_REGISTRY[e['kind']]['role']=='boss' and p.cls=='gunner':amount*=1+.08*p.items.get('targeter',0)
        if critical:amount*=1.7;p.crit+=1
        if p.items.get('burn'):amount*=1+.035*p.items.get('burn',0)
        dealt=min(e['hp'],amount);e['hp']-=dealt;p.dmg+=dealt;self.score+=dealt;p.highest=max(p.highest,dealt)
        if critical and p.items.get('critboom') and e['hp']>0:self.event('burst',e['x'],e['y'],r=32+6*p.items.get('critboom',0),team=p.team)
        self.event('hit',e['x'],e['y'],amount=round(dealt,1),team=0)
        if e['hp']<=0:
            self.enemies.pop(e['id'],None);p.kills+=1;p.xp+=10 if e['kind']!='boss' else 150
            if p.uid:
                award_gold(p.uid,70 if ENEMY_REGISTRY[e['kind']]['role']=='boss' else (12 if e['elite'] else 2))
                if p.kills%12==0:asyncio.create_task(push_account(p.uid))
                boss_kill=ENEMY_REGISTRY[e['kind']]['role']=='boss'
                drop_chance=.45 if boss_kill else (.027 if e['elite'] else .0035)
                if self.rng.random()<drop_chance and len(owned_gear(p.uid))<300:
                    rarity=roll_gear_rarity('boss' if boss_kill else 'world')
                    loot=make_gear(p.uid,p.cls,rarity);self.gear_drops+=1;self.gear_pity=0
                    asyncio.create_task(self.send(p,{'type':'gear_drop','name':loot['name'],'rarity':loot['rarity'],'slot':loot['slot'],'source':'BOSS' if boss_kill else 'ELITE' if e['elite'] else 'ENEMY'}))
                    asyncio.create_task(push_account(p.uid))
                else:self.gear_pity+=1
            if p.items.get('leech'):p.hp=min(p.max_hp,p.hp+4*p.items.get('leech',0))
            if p.cls=='duelist' and p.items.get('blooddance'):p.hp=min(p.max_hp,p.hp+2*p.items.get('blooddance',0))
            if p.items.get('shield'):p.shield=min(120,p.shield+5*p.items.get('shield',0))
            if p.items.get('blast') or (p.cls=='gunner' and p.items.get('shrapnel')):
                self.splash(p,e['x'],e['y'],42+7*p.items.get('blast',0),DAMAGE[p.cls]*(.45+.18*p.items.get('blast',0)+.15*p.items.get('shrapnel',0)),now,'burst')
            if ENEMY_REGISTRY[e['kind']]['role']=='boss':
                self.boss_count+=1;self.event('bossdown',e['x'],e['y'],name=e['kind'])
                if not p.choice:
                    pool=[x for x in ITEMS if p.items.get(x,0)<8 and (x not in ITEM_CLASS or ITEM_CLASS[x]==p.cls)]
                    p.choice=self.rng.sample(pool,min(3,len(pool)));self.event('level',p.x,p.y,player=p.id)
            elif e.get('wave')==self.wave:
                self.wave_killed+=1
                if e['elite'] and not p.choice and self.rng.random()<.22:
                    pool=[x for x in ITEMS if p.items.get(x,0)<8 and (x not in ITEM_CLASS or ITEM_CLASS[x]==p.cls)]
                    p.choice=self.rng.sample(pool,min(3,len(pool)));self.event('level',p.x,p.y,player=p.id)
            need=int(35*1.3**(p.level-1))
            if p.xp>=need:
                p.xp-=need;p.level+=1;pool=[x for x in ITEMS if p.items.get(x,0)<8 and (x not in ITEM_CLASS or ITEM_CLASS[x]==p.cls)];p.choice=self.rng.sample(pool,min(3,len(pool)))
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
    def spawn_projectile(self,p,angle,speed,power,now,kind='pulse',life=1.1,r=3,pierce=0,spread=0):
        self.proj_seq+=1;angle+=spread
        ox=math.cos(angle)*18;oy=math.sin(angle)*18
        b={'id':self.proj_seq,'owner':p.id,'team':p.team,'x':p.x+ox,'y':p.y+oy,'vx':math.cos(angle)*speed,'vy':math.sin(angle)*speed,
           'damage':power,'life':life,'born':now,'range':speed*life,'travel':0.0,'r':r,'pierce':pierce,'kind':kind,'hit':set()}
        self.projectiles[b['id']]=b

    def tick_projectiles(self,now,dt):
        for bid,b in list(self.projectiles.items()):
            owner=self.players.get(b['owner'])
            if not owner:self.projectiles.pop(bid,None);continue
            x0,y0=b['x'],b['y'];x1=x0+b['vx']*dt;y1=y0+b['vy']*dt;step=math.hypot(x1-x0,y1-y0)
            if now-b['born']>=b['life'] or b['travel']+step>b['range'] or segment_hits_wall(x0,y0,x1,y1,b['r']):
                self.projectiles.pop(bid,None);continue
            b['x'],b['y']=x1,y1;b['travel']+=step
            hit_any=False
            for t in list(self.targets(owner)):
                tid=('p'+t.id) if isinstance(t,Player) else ('e'+str(t['id']))
                if tid in b['hit']:continue
                # swept-circle hit test against the segment this tick
                tx,ty=t.x,t.y;dx=x1-x0;dy=y1-y0;den=dx*dx+dy*dy
                q=0 if den<=1e-9 else max(0,min(1,((tx-x0)*dx+(ty-y0)*dy)/den))
                cx=x0+dx*q;cy=y0+dy*q
                if math.hypot(tx-cx,ty-cy)<=hit_radius(t)+b['r']:
                    b['hit'].add(tid)
                    if isinstance(t,Player):self.hit(t,owner,b['damage'],now,'hit')
                    else:self.hurt_enemy(t,owner,b['damage'],now)
                    self.event('impact',cx,cy,team=owner.team,r=8)
                    hit_any=True
                    if b['pierce']<=0:break
                    b['pierce']-=1
            if hit_any and b.get('pierce',0)<=0:self.projectiles.pop(bid,None)

    def tick_revives(self,now,dt):
        # F is a dedicated revive interaction so Q/E/R remain combat skills.
        revivable=(self.mode!='duel' and len(self.players)>1)
        if not revivable:return
        for down in self.players.values():
            if not down.downed:continue
            if now>=down.down_until:
                down.downed=False;down.revive_progress=0;down.deaths+=1;self.event('ko',down.x,down.y,name=down.name);continue
            helpers=[p for p in self.players.values() if p.alive and not p.downed and p.id!=down.id and (self.kind=='pve' or p.team==down.team) and p.cmd.get('revive') and math.hypot(p.x-down.x,p.y-down.y)<=46]
            if helpers:down.revive_progress=min(1.8,down.revive_progress+dt)
            else:down.revive_progress=max(0,down.revive_progress-dt*.55)
            if down.revive_progress>=1.8:
                down.downed=False;down.alive=True;down.hp=max(1,down.max_hp*.38);down.shield=min(30,down.shield+18);down.invul_until=now+1.4;down.revive_progress=0
                self.event('revive',down.x,down.y,name=down.name,team=down.team)

    def basic(self,p,now):
        basic=p.basic;rate=RATE[p.cls]/(item_rate_mult(p)*(1+p.gear.get('rate',0)*.006))
        rate*= {'scatter':2.25,'chakram':1.45,'flail':1.75,'needle':1.15}.get(basic,1)
        if now-p.last_shot < rate:return
        p.last_shot=now;p.proc+=1;rank=max(1,p.ranks.get(basic,1));power=DAMAGE[p.cls]*(1+.13*(rank-1))*(1+p.perm.get('basic_amp',0))
        def deal(t,m=1):
            if isinstance(t,Player):self.hit(t,p,power*m,now)
            else:self.hurt_enemy(t,p,power*m,now)
        if basic in ('slash','hammer','flail'):
            radius={'slash':52,'hammer':64,'flail':78}[basic];half={'slash':.9,'hammer':1.15,'flail':math.pi}[basic]
            self.event('swing',p.x,p.y,angle=p.angle,r=radius,team=p.team)
            for t in list(self.targets(p)):
                d=math.hypot(t.x-p.x,t.y-p.y)
                if d>radius+(11 if isinstance(t,Player) else t.r):continue
                if half<math.pi:
                    a=math.atan2(t.y-p.y,t.x-p.x)
                    if abs((a-p.angle+math.pi)%math.tau-math.pi)>half:continue
                deal(t,1.0 if basic!='flail' else 1.18)
        elif basic=='scatter':
            # Same short-range pellet behavior as offline: visible travel, finite lifetime, walls stop every pellet.
            for i in range(8):
                spread=(i-3.5)*.105
                self.spawn_projectile(p,p.angle,450,power*.48,now,'scatter',life=.35,r=3,pierce=0,spread=spread)
        elif basic=='chakram':
            self.spawn_projectile(p,p.angle,340,power*1.1,now,'chakram',life=1.15,r=7,pierce=5)
        elif basic=='needle':
            self.spawn_projectile(p,p.angle,520,power*1.25,now,'needle',life=1.1,r=3,pierce=2)
        elif basic=='bolt':
            self.spawn_projectile(p,p.angle,420,power,now,'bolt',life=1.1,r=4,pierce=0)
        else:
            self.spawn_projectile(p,p.angle,550,power,now,'pulse',life=1.1,r=3,pierce=0)
        # temporary run-item procs
        if p.items.get('doubletap') and p.cls=='gunner' and self.rng.random()<.22*p.items.get('doubletap',0):
            t=self.nearest(p,330)
            if t:deal(t,.55)
        if p.items.get('spark') and self.rng.random()<.10*p.items.get('spark',0):
            targets=sorted(self.targets(p),key=lambda t:math.hypot(t.x-p.x,t.y-p.y))[:1+p.items.get('spark',0)]
            for t in targets[:4]:deal(t,.25);self.event('bolt',t.x,t.y,team=p.team)
        if p.items.get('storm') and p.proc%(max(3,10-p.items.get('storm',0)))==0:
            self.splash(p,p.x,p.y,110,power*.8,now,'nova')
        if p.cls=='duelist' and p.items.get('specterblade') and p.proc%max(2,5-p.items.get('specterblade',0))==0:self.splash(p,p.x,p.y,88,power*.7,now,'crescent')
        if p.cls=='brute' and p.items.get('tremor') and p.proc%max(2,6-p.items.get('tremor',0))==0:self.splash(p,p.x,p.y,92,power*.75,now,'earthsplit')
        if p.cls=='arcanist' and p.items.get('flux') and p.proc%max(2,5-p.items.get('flux',0))==0:self.splash(p,p.x,p.y,95,power*.7,now,'well')
    def cast(self,p,slot,now):
        idx={'q':0,'e':1,'r':2}[slot]
        if idx>=len(p.loadout):return
        ability=p.loadout[idx];if_cd=p.cd.get(ability,0)
        if if_cd>now:return
        category=('power' if ability in {'rail','mortar','lunge','crescent','earthsplit','grapple','chain','well'} else 'mobility' if ability in {'slide','phase','shadowstep','chainstep','charge','vault','blink','drift'} else 'utility' if ability in {'sentry','mine','riposte','mark','bastion','warcry','nova','sigil'} else 'ultimate');amp=p.perm.get(category+'_amp',0);rank=max(1,p.ranks.get(ability,1));p.cd[ability]=now+COOLDOWN.get(ability,7)*item_cooldown_mult(p)*max(.55,1-p.gear.get('cooldown',0)*.006)*(1-(p.perm.get('mobility_amp',0)*.08 if category=='mobility' else 0))
        forward=(math.cos(p.angle),math.sin(p.angle));px=p.x+forward[0]*68;py=p.y+forward[1]*68
        if p.cls=='arcanist' and p.items.get('manashield'):p.shield=min(120,p.shield+4*p.items.get('manashield',0))
        power=DAMAGE[p.cls]*(1+.13*(rank-1))*(1+amp)
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
            self.event('wave',800,565,num=self.wave,mult=self.wave_mult)
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
            self.event('wave_clear',800,565,num=self.wave,mult=self.wave_mult,floor=self.wave_floor,time=self.wave_clear)
            if self.wave%5==0 and self.gear_pity>=18:
                for p in self.players.values():
                    if p.uid and len(owned_gear(p.uid))<300:
                        loot=make_gear(p.uid,p.cls,roll_gear_rarity('cache'));self.gear_pity=0;self.gear_drops+=1
                        asyncio.create_task(self.send(p,{'type':'gear_drop','name':loot['name'],'rarity':loot['rarity'],'slot':loot['slot'],'source':'FOUNDRY CACHE'}));asyncio.create_task(push_account(p.uid))
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
            x=max(50,min(ARENA_W-50,x));y=max(50,min(ARENA_H-50,y))
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
            speed=SPEED[p.cls]*item_speed_mult(p)*(1+p.gear.get('speed',0)*.006);step=speed*dt
            nx=p.x+vx*step
            if not solid(nx,p.y):p.x=nx
            ny=p.y+vy*step
            if not solid(p.x,ny):p.y=ny
            p.angle=num(cmd.get('angle'),0,-10,10)
            dash_cd=max(2.2,4.5-(.32*p.items.get('swiftstep',0) if p.cls=='duelist' else 0))
            if cmd.get('dash') and now>=p.last_dash+dash_cd:
                p.last_dash=now;d=(vx,vy) if math.hypot(vx,vy)>.1 else p.last_move;self.move_dash(p,d,84,now);self.event('dash',p.x,p.y,team=p.team)
                if p.items.get('dashmine'):self.splash(p,p.x,p.y,50,DAMAGE[p.cls]*(.45+.18*p.items.get('dashmine',0)),now,'mine')
            if cmd.get('shoot'):self.basic(p,now)
            for slot in ('q','e','r'):
                if cmd.get(slot):self.cast(p,slot,now)
            if self.kind=='pve' and p.items.get('drone') and now>=p.drone_at:
                p.drone_at=now+max(.35,1.15-.16*p.items.get('drone',0));t=self.nearest(p,360)
                if t:self.event('sentry',p.x+24,p.y-30,team=p.team);self.hurt_enemy(t,p,DAMAGE[p.cls]*(.32+.14*p.items.get('drone',0)),now)
            if self.kind=='pve' and p.items.get('orbit') and now>=p.orbit_at:
                p.orbit_at=now+.55;self.splash(p,p.x,p.y,52+7*p.items.get('orbit',0),DAMAGE[p.cls]*(.15+.08*p.items.get('orbit',0)),now,'orbit')
        self.tick_projectiles(now,dt)
        self.tick_revives(now,dt)
        if self.kind=='pvp':
            active=[sum(p.alive and p.team==team for p in self.players.values()) for team in (0,1)]
            if 0 in active:
                winner=0 if active[0]>active[1] else 1
                self.wins[winner]+=1;self.event('win',800,565,team=winner,num=self.round)
                if self.wins[winner]>=3:
                    self.state='finished';self.event('finished',800,565,team=winner)
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
            if not any(p.alive for p in self.players.values()):self.state='finished';self.event('finished',800,565,team=-1)
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
                if now-self.broadcast>=.066:
                    self.broadcast=now;await self.everyone(self.packet(now))
                    if self.state=='finished':break
                await asyncio.sleep(.033)
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
                    HUB_PLAYERS[uid]={'x':450+random.randint(-35,35),'y':402+random.randint(-20,20),'angle':0,'moving':False,'cls':'gunner','inMatch':False,'look':gear_look(uid,'gunner'),'last':time.monotonic(),'broadcast':0}
                    await ws.send_json({'type':'authenticated','token':token})
                    await push_account(uid);await push_population();await push_hub()
                except ValueError as exc:
                    LOGIN_FAIL[key].append(time.monotonic())
                    await ws.send_json({'type':'error','message':str(exc)})
                continue
            if typ=='logout':
                if uid:CONN.execute('DELETE FROM sessions WHERE uid=?',(uid,))
                break
            if uid is None:
                await ws.send_json({'type':'error','message':'Log in to play online.'});continue
            if typ=='hub_input':
                h=HUB_PLAYERS.get(uid)
                if h:
                    now=time.monotonic();dt=min(.12,max(.0,now-h.get('last',now)));h['last']=now
                    dx=num(data.get('dx'),0,-1,1);dy=num(data.get('dy'),0,-1,1);mag=math.hypot(dx,dy)
                    if mag>1:dx/=mag;dy/=mag
                    nx=h['x']+dx*175*dt;ny=h['y']+dy*175*dt
                    if not hub_solid(nx,h['y']):h['x']=nx
                    if not hub_solid(h['x'],ny):h['y']=ny
                    h['angle']=num(data.get('angle'),h['angle'],-math.tau*2,math.tau*2);h['moving']=mag>.08
                    if now-h.get('broadcast',0)>.065:h['broadcast']=now;await push_hub()
                continue
            if typ=='hub_class':
                cls=str(data.get('cls',''))
                if cls in SPEED and uid in HUB_PLAYERS:
                    HUB_PLAYERS[uid]['cls']=cls
                    # Starter equipment is only generated for the class the player actively selects.
                    if not any(g['class_id']==cls for g in owned_gear(uid)) and len(owned_gear(uid))<300:make_gear(uid,cls,'Common');await push_account(uid)
                    HUB_PLAYERS[uid]['look']=gear_look(uid,cls);await push_hub()
                continue
            if typ in ('trade_invite','trade_cancel','trade_offer','trade_accept'):
                try:await trade_message(uid,data)
                except ValueError as ex:await ws.send_json({'type':'error','message':str(ex)})
                continue
            if typ=='equip':
                gid=str(data.get('item',''));active_cls=HUB_PLAYERS.get(uid,{}).get('cls','gunner')
                row=CONN.execute('SELECT * FROM gear WHERE id=? AND owner=?',(gid,uid)).fetchone()
                if not row or row['class_id']!=active_cls or room and room.state=='playing':
                    await ws.send_json({'type':'error','message':'That item is locked to another class or cannot be equipped now'});continue
                CONN.execute('UPDATE gear SET equipped=0 WHERE owner=? AND class_id=? AND slot=?',(uid,active_cls,row['slot']))
                CONN.execute('UPDATE gear SET equipped=1 WHERE id=? AND owner=?',(gid,uid))
                await push_account(uid)
                if uid in HUB_PLAYERS:HUB_PLAYERS[uid]['look']=gear_look(uid,active_cls);await push_hub()
                continue
            if typ=='unequip':
                if room and room.state=='playing':continue
                CONN.execute('UPDATE gear SET equipped=0 WHERE id=? AND owner=?',(str(data.get('item','')),uid))
                await push_account(uid)
                if uid in HUB_PLAYERS:HUB_PLAYERS[uid]['look']=gear_look(uid,HUB_PLAYERS[uid].get('cls','gunner'));await push_hub()
                continue
            if typ=='enchant':
                gid=str(data.get('item',''));row=CONN.execute('SELECT * FROM gear WHERE id=? AND owner=?',(gid,uid)).fetchone()
                if not row or room and room.state=='playing':await ws.send_json({'type':'error','message':'That gear cannot be enchanted now'});continue
                price=enchant_price(row)
                try:
                    CONN.execute('BEGIN IMMEDIATE')
                    if user_row(uid)['gold']<price:raise ValueError('Not enough gold ('+str(price)+' required)')
                    tier,bonus=roll_enchant(row);CONN.execute('UPDATE users SET gold=gold-? WHERE id=?',(price,uid))
                    CONN.execute('UPDATE gear SET enchant=enchant+1,enchant_rolls=enchant_rolls+1,enchant_tier=?,enchant_data=? WHERE id=? AND owner=?',(tier,json.dumps(bonus,separators=(',',':')),gid,uid))
                    CONN.execute('COMMIT')
                except ValueError as ex:
                    CONN.execute('ROLLBACK');await ws.send_json({'type':'error','message':str(ex)});continue
                except Exception:
                    CONN.execute('ROLLBACK');raise
                await push_account(uid);await ws.send_json({'type':'enchant_result','item':gid,'tier':tier,'stats':bonus,'cost':price});continue
            if typ=='sell_items':
                raw=data.get('items',[])
                if not isinstance(raw,list) or room and room.state=='playing':await ws.send_json({'type':'error','message':'Cannot sell gear now'});continue
                ids=list(dict.fromkeys(str(x) for x in raw[:200] if x));rows=[]
                for gid in ids:
                    r=CONN.execute('SELECT * FROM gear WHERE id=? AND owner=? AND equipped=0',(gid,uid)).fetchone()
                    if r:rows.append(r)
                if not rows:await ws.send_json({'type':'error','message':'No sellable items selected'});continue
                total=sum(gear_sell_value(r) for r in rows)
                try:
                    CONN.execute('BEGIN IMMEDIATE')
                    for r in rows:CONN.execute('DELETE FROM gear WHERE id=? AND owner=? AND equipped=0',(r['id'],uid))
                    CONN.execute('UPDATE users SET gold=MIN(2000000000,gold+?) WHERE id=?',(total,uid));CONN.execute('COMMIT')
                except Exception:
                    CONN.execute('ROLLBACK');raise
                await push_account(uid);await ws.send_json({'type':'sale_result','count':len(rows),'gold':total});continue
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
                        if room.state=='playing':room.state='finished';room.event('disconnect',800,565)
                        await room.everyone(room.packet(time.monotonic()))
                    else:ROOMS.pop(room.code,None)
                    player=None;room=None
                    if uid in HUB_PLAYERS:HUB_PLAYERS[uid]['inMatch']=False;await push_hub()
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
                player.gear=equip_stats(uid,cls);load_player_build(player);room.assign_teams();room.last_activity=time.monotonic()
                if uid in HUB_PLAYERS:HUB_PLAYERS[uid]['inMatch']=True;HUB_PLAYERS[uid]['cls']=cls;await push_hub()
                await ws.send_json({'type':'joined','id':player.id,'code':room.code,'mode':room.mode,'capacity':room.capacity})
                await room.everyone(room.packet(time.monotonic()))
                continue
            if not player or not room:continue
            room.last_activity=time.monotonic()
            if typ=='ready' and room.state=='lobby':
                player.ready=bool(data.get('ready',True));await room.everyone(room.packet(time.monotonic()))
            elif typ=='class' and room.state=='lobby':
                if data.get('cls') in SPEED:player.cls=data['cls'];load_player_build(player);player.gear=equip_stats(uid,player.cls);player.max_hp=player.hp=HEALTH[player.cls]*(1+player.gear.get('hp',0)*.01+player.perm.get('hp',0))
                room.assign_teams();await room.everyone(room.packet(time.monotonic()))
            elif typ=='loadout' and room.state=='lobby':
                # Offline save can't be trusted by server. Validate class/ability membership, not unlocks.
                ids=data.get('ids',[]);basic=data.get('basic')
                if isinstance(ids,list):player.loadout=[v for v in ids[:3] if v in ABILITIES[player.cls]]
                if basic in BASIC_ABILITIES[player.cls]:player.basic=basic
            elif typ=='start' and player.id==room.host and room.state=='lobby':
                if len(room.players)!=room.capacity or not all(p.ready for p in room.players.values()):
                    await room.send(player,{'type':'error','message':'All slots must be filled and ready'});continue
                room.begin(time.monotonic());await room.everyone(room.packet(time.monotonic()))
            elif typ=='input' and room.state=='playing':
                now=time.monotonic()
                if now-last_input<.025:continue
                last_input=now
                player.cmd={k:data.get(k,False) for k in ('shoot','dash','q','e','r','revive')}
                for k in ('dx','dy'):player.cmd[k]=num(data.get(k),0,-1,1)
                player.cmd['angle']=num(data.get('angle'),0,-math.tau*2,math.tau*2)
            elif typ=='pick' and room.kind=='pve':
                choice=str(data.get('item',''))
                if choice in player.choice:
                    player.items[choice]=min(10,player.items.get(choice,0)+1);player.choice=[]
                    oldmax=player.max_hp;player.max_hp=HEALTH[player.cls]*(1+player.gear.get('hp',0)*.01+player.perm.get('hp',0)) + 15*player.items.get('battery',0)
                    if player.cls=='brute':player.max_hp+=12*player.items.get('jugger',0)
                    if choice in ('battery','jugger'):player.hp=min(player.max_hp,player.hp+(player.max_hp-oldmax)+8)
                    if choice=='shield':player.shield=min(120,player.shield+20)
                    await room.send(player,{'type':'picked','item':choice})
    finally:
        if uid:
            await trade_cancel(uid,'Other player disconnected')
            AUTHED.pop(uid,None);HUB_PLAYERS.pop(uid,None)
            await push_population();await push_hub()
        if player and room and room.code in ROOMS:
            room.players.pop(player.id,None)
            if room.players:
                if room.host==player.id:room.host=next(iter(room.players))
                room.assign_teams()
                if room.state=='playing':room.state='finished';room.event('disconnect',800,565)
                await room.everyone(room.packet(time.monotonic()))
            else:
                ROOMS.pop(room.code,None)
        await ws.close()
    return ws

async def health(request):return web.json_response({'status':'ok','rooms':len(ROOMS),'version':'pixel-online-0.7.6-projectiles-revives'})
app=web.Application()
app.router.add_get('/health',health)
app.router.add_get('/ws',socket)
app.router.add_get('/',health)
if __name__=='__main__':web.run_app(app,host=HOST,port=PORT)
