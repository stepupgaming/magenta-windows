// The sound library: prompts Magenta RealTime 2 responds to well, grouped
// for browsing and tagged for search. Each line is "prompt | tags".
//
// How these were chosen: MusicCoCa turns a prompt into one point in style
// space. Short, concrete phrases in stock-music vocabulary (a genre, an
// instrument, a texture or mood) land best. Negations ("no drums") embed next
// to what they negate, lyrics are not sung, and artist names are left out.
// Sources: the upstream magenta-realtime model card and app suggestions, the
// Lyria RealTime prompt guide and notebooks, and the MusicCoCa paper.

import type { LibraryEntry } from "./library-search.ts";
import type { DrumMode, NoteMode } from "./types.ts";

export interface LibraryCategory {
  hint: string;
  id: string;
  label: string;
}

export interface LibraryBlend {
  description: string;
  drums: DrumMode;
  name: string;
  noteMode: NoteMode;
  prompts: [string, number][];
}

export const LIBRARY_CATEGORIES: LibraryCategory[] = [
  { hint: "Styles and scenes", id: "genres", label: "Genres" },
  {
    hint: "Single sources to blend in",
    id: "instruments",
    label: "Instruments",
  },
  { hint: "Drums and grooves", id: "rhythm", label: "Drums & Grooves" },
  { hint: "Feelings and energy", id: "moods", label: "Moods" },
  {
    hint: "Production and sound design",
    id: "textures",
    label: "Textures & Production",
  },
  { hint: "Regional styles and instruments", id: "world", label: "World" },
  {
    hint: "Score, trailer, and game music",
    id: "cinematic",
    label: "Cinematic & Game",
  },
  { hint: "Decades and scenes", id: "eras", label: "Eras & Scenes" },
  { hint: "Ready-made richer descriptions", id: "combos", label: "Combos" },
];

const GENRES = `
deep house groove | electronic, dance, house, club, four on the floor
tech house | electronic, house, club, dance, uptempo
acid house | electronic, house, 303, acid, club, rave
chicago house | electronic, house, dance, club, classic
progressive house | electronic, house, edm, euphoric, uptempo
afro house | electronic, house, african, percussion, club
soulful house | electronic, house, soul, keys, uplifting
tropical house | electronic, house, summer, chill, bright
lo-fi house | electronic, house, lofi, dusty, chill
electro house | electronic, edm, house, club, energetic
big room house | electronic, edm, house, festival, uptempo
melodic techno | electronic, techno, club, hypnotic, dark
minimal techno | electronic, techno, minimal, hypnotic, club
detroit techno | electronic, techno, synth, club, classic
industrial techno | electronic, techno, industrial, dark, hard
hard techno | electronic, techno, hard, fast, rave
dub techno | electronic, techno, dub, deep, hypnotic
acid techno | electronic, techno, 303, acid, rave
ambient techno | electronic, techno, ambient, chill, hypnotic, focus
trance | electronic, trance, edm, euphoric, uptempo
uplifting trance | electronic, trance, edm, euphoric, anthem
psytrance | electronic, trance, psychedelic, fast, rave
goa trance | electronic, trance, psychedelic, 90s, rave
drum and bass | electronic, dnb, breakbeat, fast, jungle
liquid drum and bass | electronic, dnb, smooth, fast, chill
neurofunk | electronic, dnb, dark, aggressive, bass
jungle | electronic, dnb, breakbeat, fast, rave
breakbeat | electronic, breaks, dance, uptempo, drums
big beat | electronic, breaks, energetic, 90s, dance
uk garage | electronic, ukg, garage, 2-step, club
dubstep | electronic, bass music, edm, wobble, heavy
melodic dubstep | electronic, bass music, edm, emotional, euphoric
riddim | electronic, bass music, dubstep, heavy, wobble
future bass | electronic, edm, bass music, bright, euphoric
festival trap | electronic, edm, trap, 808, heavy
electro | electronic, 808, robotic, breakbeat, funk
synthpop | electronic, pop, synth, 80s, dance
electro synthpop | electronic, pop, synth, dance, bright
synthwave | electronic, retro, 80s, synth, neon, outrun
darksynth | electronic, synthwave, dark, aggressive, retro, synth
outrun | electronic, synthwave, retro, driving, 80s
chillwave | electronic, chill, dreamy, retro, lofi
vaporwave | electronic, retro, slowed, nostalgic, lofi
future funk | electronic, funk, disco, retro, dance
nu disco | electronic, disco, dance, funky, groove
italo disco | electronic, disco, 80s, synth, dance
disco funk | disco, funk, dance, groove, 70s
electro swing | electronic, swing, jazz, dance, retro
glitch hop | electronic, glitch, hip hop, breakbeat, bass
idm | electronic, experimental, glitch, intricate, braindance
ambient idm glitch beats | electronic, ambient, glitch, idm, chill, focus
downtempo | electronic, chill, slow, groove, lounge, focus
trip hop | electronic, hip hop, moody, slow, chill
chillout | electronic, chill, relaxing, lounge, slow
lounge | chill, jazz, cocktail, relaxing, retro
ambient electronic | electronic, ambient, chill, atmospheric, pads, focus
ambient | atmospheric, chill, calm, pads, drone, focus
dark ambient | ambient, dark, drone, eerie, atmospheric, focus
space ambient | ambient, cosmic, synth, atmospheric, calm, focus
drone | ambient, minimal, sustained, experimental, meditative
new age | ambient, calm, meditation, relaxing, healing
hyperpop | electronic, pop, glitch, energetic, bright
witch house | electronic, dark, occult, slow, eerie
footwork | electronic, juke, fast, chopped, 160 bpm
jersey club | electronic, club, bouncy, dance, uptempo
hardstyle | electronic, edm, hard, festival, uptempo
gabber | electronic, hardcore, hard, fast, rave
happy hardcore | electronic, hardcore, rave, fast, euphoric
eurodance | electronic, dance, 90s, pop, uptempo
moombahton | electronic, latin, reggaeton, club, dance
breakcore | electronic, breakbeat, chaotic, fast, experimental
darkwave | electronic, dark, synth, post-punk, moody
ebm | electronic, industrial, dark, driving, body music
industrial | electronic, industrial, dark, metallic, aggressive
chiptune | electronic, 8-bit, retro, game, video game
grime | electronic, uk, bass, 140 bpm, dark
uk drill | hip hop, drill, dark, uk, 808, rap
phonk | hip hop, 808, cowbell, dark, memphis
drift phonk | hip hop, phonk, cowbell, aggressive, 808
lo-fi hip hop beat | hip hop, lofi, chill, study, beats, focus
boom bap | hip hop, 90s, drums, sample, rap, beats
trap beat | hip hop, trap, 808, hi hats, rap, beats
jazzy hip hop | hip hop, jazz, chill, sample, groove, beats
g-funk | hip hop, funk, synth, west coast, 90s
cloud rap beat | hip hop, dreamy, trap, atmospheric, rap
instrumental hip hop | hip hop, beats, sample, groove, rap
chillhop | hip hop, chill, jazz, lofi, study, beats
old school hip hop | hip hop, 80s, breakbeat, classic, rap, beats
contemporary r&b | r&b, rnb, soul, smooth, modern
neo soul | r&b, rnb, soul, smooth, keys, groove
new jack swing | r&b, rnb, 90s, swing, dance
quiet storm | r&b, rnb, smooth, slow, romantic
alternative r&b | r&b, rnb, moody, atmospheric, modern
indie pop | pop, indie, bright, upbeat, guitar
dream pop | pop, indie, dreamy, reverb, shoegaze
electropop | pop, electronic, synth, upbeat, dance
k-pop | pop, korean, dance, bright, upbeat
j-pop | pop, japanese, bright, upbeat, anime
city pop | pop, japanese, 80s, funk, retro
bedroom pop | pop, indie, lofi, mellow, intimate
art pop | pop, experimental, eclectic, art
dance pop | pop, dance, upbeat, club, edm
piano ballad | pop, piano, ballad, slow, emotional, keys
yacht rock | rock, soft rock, smooth, 70s, breezy
soft rock | rock, mellow, smooth, 70s, easy listening
classic rock | rock, guitar, 70s, driving, riffs
garage rock | rock, raw, guitar, energetic, lo-fi
gritty garage rock | rock, gritty, guitar, raw, energetic
surf rock | rock, guitar, reverb, 60s, surf
psychedelic rock | rock, psychedelic, fuzz, 60s, trippy
blues rock | rock, blues, guitar, gritty, riffs
hard rock | rock, heavy, guitar, energetic, riffs
indie rock | rock, indie, guitar, upbeat, jangly
alternative rock | rock, alternative, guitar, 90s, alt
post-rock | rock, atmospheric, guitar, cinematic, crescendo
math rock | rock, intricate, guitar, odd meter, tapping
shoegaze | rock, dreamy, fuzz, wall of sound, reverb
noise rock | rock, noise, abrasive, experimental, distorted
post-punk | rock, punk, dark, bass, 80s
punk rock | rock, punk, fast, energetic, raw
pop punk | rock, punk, pop, upbeat, energetic
midwest emo | rock, emo, twinkly, guitar, emotional
grunge | rock, 90s, distorted, gritty, heavy
stoner rock | rock, heavy, fuzz, desert, slow
krautrock | rock, motorik, hypnotic, experimental, 70s
progressive rock | rock, prog, complex, 70s, epic
space rock | rock, psychedelic, cosmic, atmospheric, spacey
southern rock | rock, southern, guitar, americana, slide guitar
rockabilly | rock, 50s, retro, upbeat, slap bass
jam band | rock, improvisation, groove, live, jam
funk rock | rock, funk, groove, energetic, slap bass
slowcore | rock, slow, sad, minimal, indie
heavy metal | metal, heavy, guitar, aggressive, riffs
thrash metal | metal, fast, aggressive, riffs, thrash
doom metal | metal, slow, heavy, dark, doom
black metal | metal, dark, fast, tremolo, atmospheric
death metal | metal, extreme, aggressive, blast beats, heavy
power metal | metal, epic, fast, melodic, anthem
progressive metal | metal, prog, complex, odd meter, technical
djent | metal, prog, polyrhythmic, heavy, palm mute
metalcore | metal, hardcore, breakdown, aggressive, heavy
nu metal | metal, 2000s, heavy, groove, downtuned
symphonic metal | metal, orchestral, epic, choir, heavy
sludge metal | metal, slow, heavy, dirty, doom
post-metal | metal, atmospheric, heavy, cinematic, crescendo
industrial metal | metal, industrial, electronic, aggressive, heavy
funk metal | metal, funk, slap bass, groove, heavy
hardcore punk | punk, fast, aggressive, raw, hardcore
bebop | jazz, fast, swing, saxophone, improvisation
cool jazz | jazz, mellow, smooth, 50s, trumpet
hard bop | jazz, swing, blues, horns, soulful
modal jazz | jazz, modal, spacious, smooth, improvisation
free jazz | jazz, experimental, chaotic, improvisation, avant-garde
jazz fusion | jazz, fusion, electric, complex, groove
latin jazz | jazz, latin, percussion, groove, piano
acid jazz | jazz, funk, groove, 90s, dance
smooth jazz | jazz, smooth, saxophone, mellow, easy listening
swing jazz | jazz, swing, big band, dance, uptempo
big band jazz | jazz, big band, horns, swing, brass
gypsy jazz | jazz, acoustic, guitar, violin, swing, manouche
jazz piano trio | jazz, piano, trio, acoustic, keys
nu jazz | jazz, electronic, groove, modern, chill
spiritual jazz | jazz, spiritual, modal, saxophone, cosmic
dark jazz | jazz, dark, noir, slow, moody
dixieland | jazz, 1920s, brass, upbeat, new orleans
jazz ballad | jazz, slow, romantic, mellow, ballad
bossa nova | latin, brazilian, jazz, chill, guitar
exotica | lounge, retro, tropical, vibraphone, 50s
delta blues | blues, acoustic, slide guitar, raw, rootsy
chicago blues | blues, electric guitar, harmonica, band, gritty
slow blues | blues, slow, guitar, soulful, emotional
soul | soul, r&b, horns, groove, 60s
northern soul | soul, uptempo, dance, 60s, stomping
funk | funk, groove, bass, horns, danceable
funk jam | funk, jam, groove, live, improvisation
disco | dance, 70s, strings, four on the floor, groovy
boogie | funk, 80s, dance, synth bass, groove
gospel | gospel, choir, soulful, church, uplifting
doo-wop | 50s, vocal harmony, retro, romantic, oldies
country | country, guitar, americana, twang
alternative country | country, alt-country, americana, indie, twang
bluegrass | country, banjo, fiddle, acoustic, fast
americana | folk, country, acoustic, roots, rootsy
indie folk | folk, indie, acoustic, gentle, guitar
folk rock | folk, rock, acoustic, 60s, jangly
acoustic singer-songwriter | acoustic, folk, guitar, intimate, mellow
honky tonk | country, piano, twang, barroom, keys
western swing | country, swing, fiddle, steel guitar, dance
baroque | classical, harpsichord, strings, 1700s, ornate
classical | classical, orchestral, strings, elegant, orchestra
string quartet | classical, strings, chamber, acoustic, violin, cello
chamber music | classical, chamber, strings, intimate, acoustic
minimalist classical | classical, minimal, repetitive, piano, hypnotic, focus
contemporary classical | classical, modern, strings, experimental, avant-garde
neoclassical piano | classical, piano, emotional, cinematic, keys, focus
renaissance music | early music, lute, consort, 1500s, classical
choral music | choir, classical, sacred, voices, choral
impressionist piano | classical, piano, dreamy, keys, elegant
reggae | reggae, jamaican, offbeat, laid back, skank
roots reggae | reggae, jamaican, roots, bass, laid back
dub | reggae, dub, echo, bass, delay
ska | ska, jamaican, upbeat, horns, offbeat
rocksteady | jamaican, 60s, reggae, smooth, laid back
dancehall | jamaican, dancehall, riddim, club, dance
reggaeton | latin, dembow, club, dance, urban
latin pop | latin, pop, upbeat, dance, bright
afrobeats | african, afrobeats, dance, groove, nigerian
amapiano | african, house, log drum, south african, groove, keys
afrobeat | african, afrobeat, horns, funk, groove
musique concrete | experimental, tape, found sound, avant-garde
glitch | electronic, glitch, experimental, digital, clicks
noise | experimental, harsh, abrasive, distorted, noise
marching band | brass, drums, marching, parade, band
easy listening | lounge, mellow, retro, relaxing, background
meditation music | ambient, calm, meditation, relaxing, yoga
lullaby | gentle, sleep, soft, calm, children
`;

const INSTRUMENTS = `
grand piano | piano, keys, acoustic, classical
upright piano | piano, keys, acoustic, intimate
felt piano | piano, keys, soft, intimate, muted
honky-tonk piano | piano, keys, saloon, vintage, ragtime
prepared piano | piano, keys, experimental, percussive
toy piano | piano, keys, playful, tinkly, quirky
ragtime piano | piano, keys, ragtime, vintage, upbeat
stride piano | piano, keys, jazz, swing, vintage
smooth piano chords | piano, keys, smooth, mellow, chords
rhodes electric piano | rhodes, keys, electric piano, warm, ep
warm rhodes electric piano | rhodes, keys, electric piano, warm, mellow
wurlitzer electric piano | keys, electric piano, wurly, vintage, soul
fm electric piano | keys, electric piano, 80s, synth, glassy
clavinet | keys, funk, clav, funky, percussive
hammond organ | organ, keys, soul, gospel, b3
church organ | organ, keys, sacred, church, pipe organ
vintage combo organ | organ, keys, 60s, garage, retro
harpsichord | keys, baroque, classical, plucked, harpsichord
clavichord | keys, baroque, early music, intimate, plucked
celesta | keys, bells, magical, tinkly, orchestral
mellotron flutes | keys, mellotron, 60s, psychedelic, tape
mellotron strings | keys, mellotron, strings, 70s, prog
r&b smooth keys | keys, r&b, rnb, smooth, chords
accordion | accordion, folk, bellows, squeezebox, keys
melodica | keys, reeds, dub, playful, wind
harmonica | harmonica, blues, folk, harp, reed
delicate vintage music box | music box, tinkly, lullaby, delicate, vintage
analog synth | synth, analog, electronic, retro, synthesizer
synth pads | synth, pads, ambient, lush, atmospheric
warm analog pads | synth, pads, analog, warm, ambient
ambient pad synthesizer | synth, pads, ambient, atmospheric, calm, focus
supersaw lead | synth, lead, trance, edm, bright
supersaw complextro chords | synth, chords, edm, electro, complextro
trance arpeggiated synth | synth, arpeggio, trance, edm, uptempo
arpeggiated analog synth | synth, arpeggio, analog, retro, sequence
retro synthwave analog lead | synth, lead, synthwave, retro, 80s
detuned analog lead | synth, lead, analog, detuned, retro
polysynth chords | synth, chords, 80s, lush, pads
synth brass stabs | synth, brass, stabs, 80s, punchy
pluck synth | synth, pluck, edm, bright, staccato
fm synth bells | synth, bells, fm, glassy, digital
glassy synth bells | synth, bells, glassy, crystalline, bright
modular synth bleeps | synth, modular, bleeps, experimental, generative
spacey synths | synth, space, cosmic, atmospheric, sci-fi
dirty synths | synth, distorted, gritty, aggressive, electronic
string machine | synth, strings, 70s, vintage, lush
square wave lead | synth, chiptune, 8-bit, lead, retro
vocoder chords | synth, vocoder, robotic, chords, electronic
theremin | electronic, eerie, sci-fi, vintage, wobbly
acid 303 bassline | bass, 303, acid, squelchy, synth bass
303 acid bass | bass, 303, acid, squelchy, techno
808 bass | bass, 808, hip hop, trap, sub
sub bass | bass, sub, deep, low end, electronic
reese bass | bass, dnb, dark, detuned, growl
dubstep wobble bass synth | bass, dubstep, wobble, synth bass, edm, synth
synth bass | bass, synth bass, analog, electronic, groove, synth
boomy bass | bass, deep, boomy, low end, sub
funky bass guitar | bass, funk, groove, electric bass, funky, guitar
slap bass | bass, funk, slap, popping, groove
fretless bass | bass, smooth, jazz, fusion, mellow
fingerstyle electric bass | bass, electric bass, groove, warm, fingers
upright bass | bass, double bass, jazz, acoustic, upright
walking upright bass | bass, double bass, jazz, walking, swing
acoustic guitar | guitar, acoustic, strumming, folk
fingerpicked acoustic guitar | guitar, acoustic, fingerpicking, folk, gentle
acoustic folk guitar | guitar, acoustic, folk, strumming, warm
warm acoustic guitar | guitar, acoustic, warm, mellow, strumming
nylon string classical guitar | guitar, nylon, classical, spanish, acoustic
twelve string guitar | guitar, acoustic, 12-string, jangly, shimmering
clean electric guitar | guitar, electric, clean, mellow, chords
jazz guitar | guitar, jazz, hollow body, mellow, chords
funky rhythm guitar | guitar, funk, rhythm, wah, chicken scratch
wah wah guitar | guitar, funk, wah, 70s, groove
reggae rhythm guitar | guitar, reggae, skank, offbeat, rhythm
surf rock guitar | guitar, surf, reverb, twang, 60s
slide guitar | guitar, slide, blues, bottleneck, twang
pedal steel guitar | guitar, steel, country, twang, crying
lap steel guitar | guitar, steel, hawaiian, slide, twang
resonator guitar | guitar, blues, resophonic, slide, metallic
twangy baritone guitar | guitar, twang, baritone, western, reverb
jangly electric guitar | guitar, jangly, indie, bright, chiming
distorted electric guitar | guitar, distorted, rock, heavy, overdrive
shredding guitar | guitar, shred, virtuoso, metal, solo
chugging metal guitar riffs | guitar, metal, riffs, palm mute, heavy
fuzz guitar | guitar, fuzz, psychedelic, gritty, 60s
tremolo guitar | guitar, tremolo, reverb, surf, vintage
power chords | guitar, rock, punk, distorted, riffs
ukulele | ukulele, uke, hawaiian, strumming, bright
mandolin | mandolin, folk, bluegrass, plucked, strings
melodramatic tremolo mandolin | mandolin, tremolo, dramatic, italian, strings
banjo | banjo, bluegrass, country, plucked, folk
country banjo picking | banjo, country, picking, bluegrass, upbeat
bluegrass picked banjo | banjo, bluegrass, picking, fast, country
violin | violin, strings, classical, bowed
solo violin | violin, strings, solo, expressive, classical
fiddle | fiddle, violin, strings, country, folk
viola ensemble | viola, strings, ensemble, warm, classical
violin chamber ensemble | violin, strings, chamber, classical, ensemble
classical cello | cello, strings, classical, warm, bowed
cello | cello, strings, warm, bowed, deep
double bass | bass, strings, orchestral, bowed, deep
lush strings | strings, orchestral, lush, cinematic, sweeping
string ensemble | strings, orchestral, ensemble, classical, violin
pizzicato strings | strings, pizzicato, plucked, playful, orchestral
tremolo strings | strings, tremolo, tense, orchestral, cinematic
harp | harp, plucked, strings, glissando, magical
flute | flute, woodwind, airy, melodic, wind
alto flute | flute, woodwind, breathy, soft, mellow
piccolo | flute, woodwind, bright, high, orchestral
clarinet | clarinet, woodwind, reed, warm, jazz
bass clarinet | clarinet, woodwind, low, dark, reed
oboe | oboe, woodwind, reed, pastoral, orchestral
orchestral sustained oboe | oboe, woodwind, orchestral, sustained, classical, orchestra
bassoon | bassoon, woodwind, low, playful, orchestral
woodwinds | woodwind, orchestral, flute, clarinet, ensemble
gentle microtonal flutes | flute, woodwind, microtonal, gentle, airy
recorder | recorder, woodwind, early music, simple, folk
alto saxophone | saxophone, sax, jazz, reed, brass
tenor saxophone | saxophone, sax, jazz, smoky, soulful
soprano saxophone | saxophone, sax, smooth jazz, bright, reed
baritone saxophone | saxophone, sax, low, funk, honking
trumpet | trumpet, brass, horn, bright, jazz
muted trumpet | trumpet, brass, muted, jazz, noir
flugelhorn | brass, horn, mellow, jazz, warm
trombone | trombone, brass, horn, slide, jazz
tuba | tuba, brass, low, oompah, marching
french horn | brass, horn, orchestral, noble, warm
fanfare french horn | brass, horn, fanfare, heroic, orchestral
brass section | brass, horns, section, punchy, big band
horn section | horns, brass, funk, soul, stabs
euphonium | brass, horn, mellow, band, low
vibraphone | vibraphone, vibes, mallets, jazz, percussion
bowed vibraphone sustained metallic ringing | vibraphone, bowed, metallic, ringing, ambient
marimba | marimba, mallets, wooden, percussion, warm
latin mallet marimba | marimba, mallets, latin, percussion, wooden
xylophone | xylophone, mallets, percussion, playful, bright
glockenspiel | glockenspiel, bells, mallets, tinkly, bright
tubular bells | bells, chimes, orchestral, percussion, ringing
handbells | bells, handbells, chimes, festive, ringing
steel guitar and fiddle | country, steel guitar, fiddle, strings, twang, guitar
wordless choir | choir, vocals, voices, ethereal, choral
choir ahhs | choir, vocals, voices, pads, angelic
humming vocals | vocals, humming, voice, soft, intimate
scat singing | vocals, scat, jazz, voice, improvisation
beatbox | vocals, beatbox, rhythm, mouth percussion, hip hop
whistling melody | whistle, melody, western, carefree, voice
musical saw | saw, eerie, wobbly, vintage, bowed
glass harmonica | glass, ethereal, eerie, crystalline, bowed
timpani | timpani, orchestral, drums, percussion, epic
`;

const RHYTHM = `
808 hip hop beat | drums, 808, hip hop, beat, trap, beats
punchy kick | drums, kick, punchy, beat, club
staccato rhythms | rhythm, staccato, percussive, tight, groove
four on the floor kick | drums, kick, house, dance, club
funky drum break | drums, funk, break, groove, breakbeat
breakbeat drums | drums, breakbeat, breaks, groove, uptempo
chopped jungle breaks | drums, jungle, dnb, breakbeat, fast
rolling drum and bass breaks | drums, dnb, breakbeat, fast, rolling
boom bap drums | drums, boom bap, hip hop, 90s, beat, beats
rolling trap hi hats | drums, trap, hi hats, 808, rolls
trap snare rolls | drums, trap, snare, rolls, build
909 drum machine | drums, 909, drum machine, techno, house
808 cowbell | drums, 808, cowbell, percussion, phonk
80s drum machine | drums, drum machine, 80s, retro, electronic
dusty lo-fi drums | drums, lofi, dusty, hip hop, chill
brushed jazz drums | drums, jazz, brushes, soft, swing
swinging ride cymbal | drums, jazz, swing, ride, cymbal
shuffle groove | drums, shuffle, swing, groove, blues
half time groove | drums, half time, slow, heavy, groove
double time drums | drums, fast, double time, energetic
blast beats | drums, metal, blast beats, fast, extreme
tribal drums | drums, tribal, percussion, primal, tom
thunderous tom grooves | drums, toms, tribal, epic, heavy
marching snare drumline | drums, drumline, marching, snare, band
congas and bongos | percussion, congas, bongos, latin, hand drums
bongos | percussion, bongos, latin, hand drums, groove
shaker groove | percussion, shaker, groove, light, acoustic
tambourine groove | percussion, tambourine, jingle, soul, groove
handclap groove | percussion, claps, handclaps, groove, stomp
stomp and clap rhythm | percussion, stomp, claps, folk, anthemic
live rock drums | drums, rock, live, acoustic kit, energetic
tight funk drums | drums, funk, tight, groove, pocket
motorik beat | drums, krautrock, motorik, driving, hypnotic
dembow rhythm | drums, reggaeton, dembow, latin, dance
reggae one drop | drums, reggae, one drop, laid back, offbeat
steppers rhythm | drums, reggae, dub, steppers, four on the floor
two-step garage shuffle | drums, ukg, garage, 2-step, shuffle
bouncy club drums | drums, club, bouncy, jersey club, dance
uk drill drums | drums, drill, sliding 808, hip hop, dark
afrobeat drums | drums, afrobeat, african, polyrhythm, groove
polyrhythmic percussion | percussion, polyrhythm, african, layered, groove
glitchy beats | drums, glitch, idm, stutter, electronic
minimal clicky percussion | percussion, minimal, clicks, techno, micro
syncopated drum groove | drums, syncopated, groove, funky, offbeat
cajon groove | percussion, cajon, acoustic, unplugged, groove
hand percussion | percussion, hand drums, acoustic, organic, groove
metallic industrial percussion | percussion, industrial, metallic, clanking, dark
crisp electronic drums | drums, electronic, crisp, punchy, programmed
deep kick drum | drums, kick, deep, sub, bass
slow hip hop groove | drums, hip hop, slow, laid back, beat, beats
laid back groove | groove, laid back, relaxed, pocket, chill
driving drums | drums, driving, energetic, uptempo, propulsive
fat beats | drums, fat, punchy, hip hop, heavy
tight groove | groove, tight, pocket, funk, drums
broken beat | drums, broken beat, jazz, syncopated, west london
jazz drum solo | drums, jazz, solo, virtuoso, improvisation
off-beat hi hats | drums, hi hats, offbeat, house, groove
snappy claps | percussion, claps, snappy, crisp, dance
drum circle | percussion, drum circle, hand drums, communal, tribal
waltz rhythm | rhythm, waltz, 3/4, triple meter, dance
6/8 groove | rhythm, 6/8, compound meter, lilting, groove
odd meter groove in 7/8 | rhythm, odd meter, 7/8, prog, balkan
clave rhythm | rhythm, clave, latin, son, salsa
shuffle blues groove | drums, blues, shuffle, swing, groove
rimshot and shaker groove | drums, rimshot, shaker, lounge, light
stuttering trap rhythm | drums, trap, stutter, 808, hi hats
`;

const MOODS = `
chill | chill, relaxed, mellow, laid back
upbeat | upbeat, happy, energetic, positive
danceable | danceable, groove, dance, upbeat
dreamy | dreamy, ethereal, floating, soft
emotional | emotional, heartfelt, moving, expressive
melancholic | melancholic, sad, wistful, minor
uplifting | uplifting, hopeful, positive, inspiring
euphoric | euphoric, ecstatic, peak, festival
dark | dark, moody, minor, brooding
ominous drone | ominous, drone, dark, foreboding, tense
eerie | eerie, creepy, unsettling, spooky
mysterious | mysterious, enigmatic, intrigue, curious
romantic | romantic, love, tender, warm
nostalgic | nostalgic, retro, wistful, memories
bittersweet | bittersweet, wistful, emotional, tender
peaceful | peaceful, calm, serene, tranquil
serene | serene, calm, still, peaceful
relaxing | relaxing, calm, spa, soothing
meditative | meditative, calm, meditation, mindful
hypnotic | hypnotic, trance, repetitive, mesmerizing
energetic | energetic, uptempo, high energy, lively
aggressive | aggressive, intense, angry, heavy
triumphant | triumphant, victory, heroic, majestic
heroic | heroic, epic, brave, adventure
epic | epic, grand, massive, cinematic
playful | playful, fun, light, bouncy
whimsical | whimsical, quirky, magical, storybook
quirky | quirky, odd, playful, offbeat
groovy | groovy, groove, funky, danceable
funky | funky, funk, groove, syncopated
sensual | sensual, sultry, smooth, romantic
sultry | sultry, smoky, sensual, late night
hopeful | hopeful, optimistic, uplifting, bright
joyful | joyful, happy, celebratory, cheerful
sad | sad, sorrow, melancholic, slow
somber | somber, grave, dark, slow
mournful | mournful, grief, elegy, sad
tense | tense, suspense, anxious, tension
suspenseful | suspense, tense, thriller, building
haunting | haunting, eerie, ghostly, beautiful
menacing | menacing, threatening, dark, villain
brooding | brooding, dark, moody, introspective
introspective | introspective, reflective, thoughtful, calm
contemplative | contemplative, reflective, calm, thoughtful
wistful | wistful, longing, nostalgic, bittersweet
tender | tender, gentle, intimate, soft
intimate | intimate, close, soft, quiet
gentle | gentle, soft, calm, delicate
warm and cozy | warm, cozy, comfort, homey
sunny | sunny, bright, summer, happy
carefree | carefree, light, happy, breezy
laid back | laid back, relaxed, chill, easy
driving | driving, propulsive, energetic, forward
relentless | relentless, driving, intense, pounding
frantic | frantic, chaotic, fast, frenzied
chaotic | chaotic, wild, experimental, frantic
trippy | trippy, psychedelic, warped, hallucinatory
psychedelic | psychedelic, trippy, swirling, 60s
cosmic | cosmic, space, vast, celestial
spacious | spacious, open, airy, vast
majestic | majestic, grand, regal, noble
sacred | sacred, spiritual, holy, reverent
spiritual | spiritual, soulful, transcendent, devotional
festive | festive, celebration, party, holiday
mischievous | mischievous, sneaky, playful, cheeky
sneaky | sneaky, stealth, pizzicato, playful
cheerful | cheerful, happy, bright, sunny
bouncy | bouncy, springy, upbeat, playful
soothing | soothing, calm, gentle, healing
sleepy | sleepy, slow, drowsy, lullaby
late night | late night, nocturnal, moody, chill
rainy day | rainy, melancholic, cozy, chill
summer vibes | summer, sunny, beach, chill
focus | focus, study, concentration, background
motivational | motivational, inspiring, workout, uplifting
inspiring | inspiring, uplifting, hopeful, corporate
unsettling | unsettling, uneasy, dissonant, creepy
subdued melody | subdued, quiet, soft, minimal
virtuoso | virtuoso, technical, fast, impressive
bright and uplifting | bright, uplifting, positive, happy
dark and brooding | dark, brooding, moody, heavy
anthemic | anthemic, anthem, big, stadium
passionate | passionate, fiery, intense, emotional
`;

const TEXTURES = `
lo-fi | lofi, lo-fi, dusty, warm, vintage
vinyl crackle | vinyl, crackle, lofi, dusty, vintage
tape saturation | tape, saturation, warm, analog, vintage
tape hiss | tape, hiss, lofi, noise, cassette
warm analog saturation | analog, warm, saturation, vintage, tube
crunchy distortion | distortion, crunchy, gritty, overdrive, dirty
saturated tones | saturated, warm, dense, overdriven, analog
swirling phasers | phaser, swirling, psychedelic, modulation, effects
dub echo delay | delay, echo, dub, space, effects
tape delay | delay, echo, tape, analog, vintage
spring reverb | reverb, spring, surf, vintage, twang
plate reverb | reverb, plate, vintage, lush, studio
cathedral reverb | reverb, cathedral, huge, sacred, spacious
shimmer reverb | reverb, shimmer, ethereal, ambient, octave
reverse reverb swells | reverb, reverse, swells, ambient, dreamy
cavernous endless reverb electric guitar swells | reverb, guitar, swells, ambient, cavernous
huge drop | drop, edm, build, festival, bass
glitchy effects | glitch, stutter, digital, effects, idm
weird noises | experimental, noises, strange, sound design, quirky
bright tones | bright, crisp, treble, sparkly, airy
sustained chords | sustained, chords, pads, held, ambient
ethereal ambience | ethereal, ambience, airy, atmospheric, dreamy
sparkling arpeggios | arpeggio, sparkling, bright, synth, shimmering
bitcrushed | bitcrush, 8-bit, digital, lofi, crunchy
granular textures | granular, texture, experimental, ambient, glitch
granular synthesis frozen vocal textures | granular, vocal, frozen, ambient, experimental, synth
slow pad sweeps up | pads, sweep, riser, slow, ambient
heavily digitally distorted harp shimmer | harp, distorted, digital, shimmer, experimental
warm vinyl crackle dusty organ chords | vinyl, organ, dusty, lofi, warm, keys
euphoric washed-out noise pop fuzz | fuzz, noise pop, washed-out, euphoric, shoegaze
sidechain pumping | sidechain, pumping, edm, house, compression
filter sweeps | filter, sweep, house, edm, build
white noise risers | riser, noise, build, edm, transition
wall of sound | wall of sound, dense, layered, shoegaze, lush
lush stereo chorus | chorus, lush, stereo, modulation, 80s
wide stereo pads | pads, wide, stereo, ambient, lush
tape wobble | tape, wobble, warble, lofi, wow and flutter
lo-fi warble | lofi, warble, detuned, wobbly, vintage
dusty sample chops | samples, chops, dusty, hip hop, lofi
chopped vocal samples | vocal chops, samples, chopped, edm, vocals
pitched vocal chops | vocal chops, pitched, future bass, edm, vocals
field recordings | field recording, ambience, found sound, nature, organic
rain field recording | rain, field recording, ambience, cozy, nature
ocean waves ambience | ocean, waves, ambience, beach, nature
forest birdsong ambience | birds, forest, nature, ambience, morning
night city ambience | city, urban, ambience, night, field recording
radio static | radio, static, noise, vintage, lofi
underwater muffled | underwater, muffled, filtered, dreamy, submerged
old radio filter | radio, filtered, vintage, lofi, telephone
overdriven | overdrive, gritty, distorted, warm, crunchy
hi-fi studio production | hi-fi, polished, studio, clean, crisp
clean polished mix | clean, polished, crisp, modern, studio
live room recording | live, room, acoustic, natural, recording
live performance | live, concert, band, performance, natural
acoustic instruments | acoustic, unplugged, organic, natural, instruments
bedroom recording | bedroom, lofi, intimate, home, demo
cassette tape | cassette, tape, lofi, vintage, hiss
vhs warped | vhs, warped, lofi, retro, 80s
minimal and sparse | minimal, sparse, space, quiet, empty
dense layered | dense, layered, thick, busy, maximal
drone textures | drone, texture, ambient, sustained, dark
guitar feedback | feedback, guitar, noise, distorted, shoegaze
noise wash | noise, wash, shoegaze, ambient, dense
ambient swells | swells, ambient, pads, evolving, slow, focus
metallic resonance | metallic, resonance, ringing, industrial, bells
crystalline | crystalline, glassy, bright, shimmering, clear
airy | airy, light, breathy, open, soft
punchy mix | punchy, loud, tight, club, mixdown
deep sub bass | sub, bass, deep, low end, rumble
warm low end | warm, bass, low end, round, analog
muffled | muffled, filtered, lofi, distant, low pass
dry close-mic recording | dry, close-mic, intimate, acoustic, detailed
stutter edits | stutter, glitch, edits, idm, chopped
tape stop effect | tape stop, effect, transition, lofi, slowdown
pitch bend dives | pitch bend, dive, synth, effect, wobbly
risers and build ups | riser, build up, edm, tension, transition
detuned | detuned, warbly, lofi, wonky, seasick
gated reverb drums | gated reverb, drums, 80s, snare, big
`;

const WORLD = `
saturated gamelan choir | gamelan, choir, indonesian, saturated, asian
balinese gamelan metallic percussion | gamelan, balinese, indonesian, metallic, percussion
javanese gamelan | gamelan, javanese, indonesian, metallic, meditative
flamenco nylon guitar rasgueado | flamenco, spanish, guitar, rasgueado, nylon
flamenco guitar | flamenco, spanish, guitar, passionate, acoustic
flamenco palmas and cajon | flamenco, spanish, claps, cajon, percussion
spanish guitar | spanish, guitar, nylon, latin, acoustic
african kalimba | kalimba, african, thumb piano, mbira, gentle
west african kora polyrhythms | kora, west african, african, harp, polyrhythm
kora | kora, west african, harp, plucked, african
mbira | mbira, thumb piano, zimbabwe, african, kalimba
djembe | djembe, african, hand drums, percussion, tribal
talking drum | talking drum, west african, african, percussion, nigerian
balafon | balafon, west african, african, marimba, mallets
highlife | highlife, ghana, african, guitar, horns
juju music | juju, nigerian, african, talking drum, guitar
soukous | soukous, congolese, african, guitar, dance
congolese rumba | rumba, congolese, african, guitar, groove
desert blues guitar | desert blues, tuareg, african, guitar, hypnotic
gnawa | gnawa, moroccan, african, trance, guembri
mbalax | mbalax, senegal, african, percussion, sabar
ethiopian jazz | ethio-jazz, ethiopian, african, jazz, pentatonic
kwaito | kwaito, south african, african, house, slow
cumbia | cumbia, colombian, latin, accordion, groove
salsa | salsa, latin, cuban, piano, horns
merengue | merengue, dominican, latin, accordion, fast
bachata | bachata, dominican, latin, guitar, romantic
tango | tango, argentine, latin, bandoneon, dramatic
bandoneon tango | tango, bandoneon, argentine, accordion, dramatic
mariachi | mariachi, mexican, latin, trumpets, violins
norteño accordion | norteno, mexican, accordion, latin, polka
son cubano | son, cuban, latin, tres, clave
mambo | mambo, cuban, latin, big band, horns
cha cha cha | cha cha, cuban, latin, dance, groove
bolero | bolero, latin, romantic, guitar, slow
samba | samba, brazilian, latin, percussion, carnival
brazilian samba batucada percussion ensemble | samba, batucada, brazilian, percussion, carnival
forró | forro, brazilian, accordion, triangle, dance
baile funk | baile funk, brazilian, funk carioca, club, 808
smooth bossa nova | bossa nova, brazilian, smooth, guitar, chill
tropicalia | tropicalia, brazilian, psychedelic, 60s, latin
andean pan flute mountain melody | andean, pan flute, peruvian, flute, mountain
charango | charango, andean, plucked, strings, latin
calypso | calypso, caribbean, trinidad, steel drums, upbeat
soca | soca, caribbean, carnival, dance, uptempo
caribbean steel drums | steel drums, steelpan, caribbean, tropical, bright
zouk | zouk, caribbean, french antilles, dance, smooth
celtic folk | celtic, irish, scottish, folk, fiddle
celtic fiddle jig | celtic, fiddle, jig, irish, dance, strings
irish folk | irish, celtic, folk, fiddle, tin whistle
tin whistle | tin whistle, irish, celtic, flute, folk
uilleann pipes | uilleann pipes, irish, celtic, bagpipes, haunting
bagpipes | bagpipes, scottish, celtic, drone, highland
bodhran | bodhran, irish, celtic, frame drum, percussion
polka | polka, accordion, oompah, dance, european
polka accordion | polka, accordion, oompah, european, folk
balkan brass band | balkan, brass, gypsy, fast, odd meter
klezmer clarinet | klezmer, jewish, clarinet, eastern european, folk
greek bouzouki | greek, bouzouki, mediterranean, plucked, folk
balalaika ensemble | balalaika, russian, folk, strings, plucked
nordic folk | nordic, scandinavian, folk, fiddle, haunting
nyckelharpa | nyckelharpa, swedish, nordic, folk, bowed
hurdy-gurdy | hurdy-gurdy, medieval, drone, folk, european
musette accordion | musette, french, accordion, cafe, paris
cajun accordion | cajun, louisiana, accordion, fiddle, folk
zydeco | zydeco, louisiana, accordion, washboard, creole
appalachian dulcimer | dulcimer, appalachian, folk, plucked, american
hammered dulcimer | dulcimer, hammered, folk, shimmering, strings
middle eastern oud and darbuka groove | oud, darbuka, middle eastern, arabic, percussion
oud | oud, arabic, middle eastern, lute, plucked
persian tar | tar, persian, iranian, middle eastern, plucked
santur | santur, persian, hammered dulcimer, iranian, shimmering
ney flute | ney, flute, sufi, middle eastern, breathy
qanun | qanun, kanun, arabic, zither, plucked
arabic maqam strings | arabic, maqam, strings, middle eastern, orchestra
turkish saz | saz, baglama, turkish, plucked, folk
duduk | duduk, armenian, woodwind, mournful, reed
darbuka rhythm | darbuka, doumbek, arabic, percussion, belly dance
frame drum | frame drum, percussion, middle eastern, hand drum, ritual
rai | rai, algerian, north african, arabic, dance
indian classical sitar and tabla raga | sitar, tabla, indian, raga, classical
sitar | sitar, indian, raga, plucked, drone
tabla | tabla, indian, percussion, drums, hand drums
bansuri flute | bansuri, indian, flute, bamboo, raga
sarangi | sarangi, indian, bowed, strings, expressive
shehnai | shehnai, indian, reed, wedding, festive
harmonium | harmonium, indian, reed organ, drone, devotional
carnatic violin | carnatic, south indian, violin, indian, classical, strings
veena | veena, south indian, indian, plucked, classical
tanpura drone | tanpura, drone, indian, raga, meditative
bhangra | bhangra, punjabi, indian, dhol, dance
bengal baul | baul, bengali, indian, folk, ektara
bollywood strings | bollywood, indian, strings, film, dramatic
qawwali harmonium and handclaps | qawwali, sufi, harmonium, handclaps, devotional
japanese koto | koto, japanese, zither, plucked, asian
shamisen | shamisen, japanese, plucked, folk, asian
shakuhachi flute | shakuhachi, japanese, bamboo flute, zen, breathy
taiko drums | taiko, japanese, drums, epic, percussion
chinese guzheng | guzheng, chinese, zither, plucked, asian
erhu | erhu, chinese, bowed, two-string fiddle, asian
pipa | pipa, chinese, lute, plucked, asian
chinese bamboo flute | dizi, chinese, flute, bamboo, asian
korean gayageum | gayageum, korean, zither, plucked, asian
mongolian throat singing | throat singing, mongolian, overtone, drone, vocals
morin khuur horsehead fiddle | morin khuur, mongolian, bowed, fiddle, steppe, strings
tibetan singing bowls | singing bowls, tibetan, meditation, drone, bells
didgeridoo | didgeridoo, australian, aboriginal, drone, wind
hawaiian slack key guitar | hawaiian, slack key, guitar, island, mellow
hang drum | hang drum, handpan, steel, meditative, percussion
native american flute | native american, flute, wooden, meditative, spiritual
jaw harp | jaw harp, mouth harp, twang, folk, percussive
`;

const CINEMATIC = `
dark cinematic soundtrack | cinematic, dark, soundtrack, score, film
cinematic orchestral hits | cinematic, orchestral, hits, epic, trailer, orchestra
medieval rain | medieval, rain, fantasy, ambient, lute
orchestral score | orchestral, score, film, cinematic, strings, orchestra
epic trailer music | epic, trailer, cinematic, orchestral, hybrid
hybrid orchestral trailer | trailer, hybrid, orchestral, epic, synth, orchestra
massive brass braams | brass, braam, trailer, epic, cinematic
string ostinato | strings, ostinato, tension, cinematic, driving
film noir jazz | noir, jazz, detective, cinematic, smoky
spaghetti western | western, cowboy, cinematic, twang, whistle
space opera score | space, sci-fi, orchestral, epic, adventure, orchestra
sci-fi ambience | sci-fi, ambience, space, futuristic, synth
horror soundtrack | horror, scary, dark, dissonant, eerie
suspense thriller underscore | suspense, thriller, tense, underscore, pulse, orchestra
action chase music | action, chase, fast, intense, percussion
fantasy adventure score | fantasy, adventure, orchestral, epic, magical, orchestra
whimsical storybook score | whimsical, storybook, playful, orchestral, children, orchestra
romantic film score | romantic, film, strings, emotional, lush, orchestra
documentary underscore | documentary, underscore, background, ambient, piano, orchestra
nature documentary score | nature, documentary, orchestral, wonder, majestic, orchestra
emotional piano underscore | piano, emotional, underscore, sad, film, keys
end credits theme | credits, cinematic, emotional, orchestral, finale
military march | military, march, snare, brass, patriotic
war drums | war, drums, epic, percussion, battle
tension riser | tension, riser, build, cinematic, transition
heist music | heist, caper, funky, spy, groove
spy thriller | spy, thriller, jazz, tense, 60s
cyberpunk city | cyberpunk, futuristic, synth, neon, dark
post-apocalyptic wasteland | post-apocalyptic, desolate, dark, ambient, drone
underwater exploration | underwater, exploration, ambient, mysterious, aquatic
haunted mansion | haunted, spooky, organ, halloween, eerie
pirate adventure | pirate, adventure, sea, orchestral, swashbuckling
sword and sorcery | fantasy, epic, medieval, orchestral, battle
samurai film score | samurai, japanese, shakuhachi, taiko, cinematic, orchestra
silent film piano | silent film, piano, vintage, ragtime, comedy, keys
slapstick cartoon music | cartoon, comedy, playful, pizzicato, bouncy
stadium anthem | stadium, anthem, sports, epic, drums
video game music | video game, game, soundtrack, chiptune, adventure
8-bit boss battle | 8-bit, boss battle, video game, chiptune, intense
16-bit rpg town theme | 16-bit, rpg, video game, town, cheerful
cozy village game music | video game, cozy, village, cheerful, rpg
dungeon crawler ambience | video game, dungeon, dark, ambient, fantasy
puzzle game music | video game, puzzle, playful, light, quirky
racing game soundtrack | video game, racing, driving, energetic, electronic
title screen theme | video game, title, epic, menu, theme
victory fanfare | victory, fanfare, brass, triumphant, game
mysterious forest at night | forest, night, mysterious, ambient, fantasy
`;

const ERAS = `
roaring twenties jazz | 1920s, jazz, vintage, charleston, dance
1930s swing orchestra | 1930s, swing, big band, vintage, jazz, orchestra
40s big band | 1940s, big band, swing, brass, vintage
50s rock and roll | 1950s, rock and roll, retro, upbeat, oldies
50s exotica lounge | 1950s, exotica, lounge, vibraphone, retro
60s surf rock | 1960s, surf, guitar, reverb, retro
60s psychedelic rock | 1960s, psychedelic, rock, fuzz, trippy
60s soul | 1960s, soul, horns, groove, retro
60s spy jazz | 1960s, spy, jazz, cool, cinematic
60s bossa lounge | 1960s, bossa nova, lounge, brazilian, retro
70s disco | 1970s, disco, strings, dance, groove
70s funk | 1970s, funk, groove, horns, wah
70s prog rock | 1970s, prog, rock, mellotron, complex
70s soft rock | 1970s, soft rock, mellow, smooth, retro
70s cop show funk | 1970s, funk, cinematic, wah, action
70s library music | 1970s, library music, retro, groove, cinematic
70s roots reggae | 1970s, reggae, roots, jamaican, dub
80s synthpop | 1980s, synthpop, synth, retro, pop
80s new wave | 1980s, new wave, synth, guitar, retro
80s power ballad | 1980s, power ballad, rock, emotional, anthem
80s hair metal | 1980s, metal, glam, guitar, anthem
80s italo disco | 1980s, italo disco, synth, dance, retro
80s electro | 1980s, electro, 808, breakdance, robotic
80s city pop | 1980s, city pop, japanese, funk, smooth
80s workout aerobics | 1980s, workout, aerobics, synth, upbeat
late 80s acid house | 1980s, acid house, 303, rave, club
90s boom bap | 1990s, boom bap, hip hop, sample, rap, beats
90s grunge | 1990s, grunge, distorted, rock, alternative
90s britpop | 1990s, britpop, rock, guitar, uk
90s eurodance | 1990s, eurodance, dance, synth, uptempo
90s rave | 1990s, rave, hardcore, breakbeat, piano stabs
90s trip hop | 1990s, trip hop, moody, breakbeat, downtempo
90s r&b slow jam | 1990s, r&b, rnb, slow jam, smooth
90s trance | 1990s, trance, euphoric, synth, rave
90s jungle | 1990s, jungle, dnb, breakbeat, rave
90s house | 1990s, house, piano, dance, club
90s chillout lounge | 1990s, chillout, lounge, downtempo, chill
y2k pop | 2000s, y2k, pop, glossy, upbeat
2000s nu metal | 2000s, nu metal, heavy, downtuned, metal
2000s electroclash | 2000s, electroclash, electro, synth, punk
2000s indie rock | 2000s, indie rock, guitar, garage, upbeat
early 2000s r&b | 2000s, r&b, rnb, smooth, groove
2010s edm drop | 2010s, edm, drop, festival, big room
2010s chillwave | 2010s, chillwave, dreamy, retro, lofi
medieval music | medieval, early music, lute, drone, minstrel
renaissance consort | renaissance, early music, consort, recorder, viol
baroque court music | baroque, court, harpsichord, strings, elegant
classical era sonata | classical era, sonata, piano, elegant, 18th century
romantic era symphony | romantic era, symphony, orchestral, lush, dramatic, orchestra
1900s ragtime | 1900s, ragtime, piano, vintage, upbeat
victorian music hall | victorian, music hall, vintage, piano, theatrical
`;

const COMBOS = `
dreamy ambient pads | ambient, pads, dreamy, chill, synth, focus
synthpop groove club mix | synthpop, club, dance, groove, synth
fast swing jazz clarinet and guitar | jazz, swing, clarinet, guitar, fast
afrobeat band with horns and complex drums | afrobeat, african, horns, drums, groove
french house disco loops filter sweeps | french house, disco, filter, house, dance
cyberpunk synthwave mariachi horns | cyberpunk, synthwave, mariachi, horns, fusion, synth
trap beat with sampled funk | trap, funk, sample, hip hop, 808, beats
uk post-dubstep string quartet | dubstep, string quartet, strings, uk, fusion, edm
danceable latin jazz salsa with trombone | latin jazz, salsa, trombone, dance, latin
baroque cello meets 90s trance euphoria | baroque, cello, trance, 90s, fusion, strings
ambient pads with sub bass | ambient, pads, sub bass, chill, deep, focus
blissful ambient synth | ambient, synth, blissful, calm, pads, focus
dusty jazz piano over lo-fi drums | jazz, piano, lofi, chill, study, keys
warm rhodes chords with lazy hip hop drums | rhodes, hip hop, chill, keys, lofi, beats
smooth lo-fi beat with vinyl crackle | lofi, vinyl, chill, study, beats
deep house with soulful rhodes chords | deep house, rhodes, soulful, club, keys
melodic techno with hypnotic arpeggios | techno, melodic, arpeggio, hypnotic, club
driving techno with squelchy acid bass | techno, acid, 303, driving, rave
euphoric trance with soaring supersaw leads | trance, euphoric, supersaw, edm, anthem
liquid drum and bass with lush pads | dnb, liquid, pads, smooth, uptempo
dark neurofunk with growling reese bass | dnb, neurofunk, dark, reese, aggressive
jungle breaks with deep sub bass | jungle, dnb, breakbeat, sub bass, rave
chill downtempo with dub delays | downtempo, dub, chill, delay, lounge, focus
trip hop with moody strings and vinyl | trip hop, strings, moody, vinyl, slow
ambient drone with shimmering guitar swells | ambient, drone, guitar, shimmer, calm, focus
cinematic piano with soft string swells | cinematic, piano, strings, emotional, film, keys
epic orchestral trailer with pounding taiko | epic, trailer, orchestral, taiko, cinematic, orchestra
mellow bossa nova with nylon guitar | bossa nova, nylon, guitar, mellow, brazilian
funky disco bassline with string stabs | disco, funk, bass, strings, dance
70s funk band with wah guitar and horns | funk, 70s, wah, horns, band, guitar
neo soul groove with rhodes and bass | neo soul, rhodes, bass, groove, r&b, keys
gospel organ with soulful choir | gospel, organ, choir, soulful, church, keys
smoky jazz club saxophone ballad | jazz, saxophone, ballad, smoky, late night, sax
upbeat ska with skanking guitar and horns | ska, upbeat, horns, guitar, offbeat
roots reggae with deep bass and organ | reggae, roots, bass, organ, laid back, keys
spacey dub with tape echo | dub, echo, spacey, reggae, delay
dreamy shoegaze guitars drowning in reverb | shoegaze, dreamy, guitar, reverb, fuzz
jangly indie rock with bright guitars | indie rock, jangly, guitar, bright, upbeat
heavy doom riffs with fuzz bass | doom, metal, fuzz, riffs, heavy
fast thrash metal with galloping riffs | thrash, metal, fast, riffs, aggressive
emotional post-rock crescendo with tremolo guitars | post-rock, crescendo, emotional, guitar, cinematic
acoustic folk with banjo and fiddle | folk, banjo, fiddle, acoustic, americana, strings
gentle fingerpicked guitar and soft piano | guitar, piano, gentle, acoustic, calm, keys
lonesome harmonica over slow country guitar | harmonica, country, slow, lonesome, guitar
8-bit chiptune adventure with bright arpeggios | chiptune, 8-bit, video game, arpeggio, adventure
retro synthwave with gated drums and neon pads | synthwave, 80s, retro, gated reverb, pads, synth
dark synthwave chase with pulsing bass | synthwave, dark, chase, bass, driving, synth
vaporwave mall music with slowed saxophone | vaporwave, saxophone, slowed, retro, nostalgic, sax
city pop with funky bass and bright synths | city pop, funk, bass, synth, 80s
amapiano groove with log drum bass and shakers | amapiano, log drum, shakers, african, groove, keys
latin house with congas and piano stabs | latin, house, congas, piano, club, keys
reggaeton beat with plucked synths | reggaeton, dembow, synth, latin, club
k-pop dance track with punchy synths | k-pop, dance, synth, punchy, pop
hyperpop with glitchy pitched synths | hyperpop, glitch, synth, pop, energetic
future bass drop with wobbling chords | future bass, drop, chords, edm, euphoric
dubstep wobbles with heavy half time drums | dubstep, wobble, half time, heavy, bass music, edm
uk garage shuffle with chopped vocals | ukg, garage, shuffle, vocal chops, 2-step
footwork rhythm with chopped samples | footwork, juke, chopped, samples, fast
bluegrass breakdown with fast banjo rolls | bluegrass, banjo, fast, country, acoustic
celtic reel with tin whistle and bodhran | celtic, irish, tin whistle, bodhran, reel
flamenco guitar with handclaps and cajon | flamenco, guitar, handclaps, cajon, spanish
indian raga with sitar drone and tabla | indian, raga, sitar, tabla, drone
arabic strings and qanun over frame drums | arabic, strings, qanun, percussion, middle eastern
west african highlife guitars and horns | highlife, african, guitar, horns, upbeat
balinese gamelan with ambient synth pads | gamelan, ambient, pads, fusion, indonesian, synth
japanese koto with lo-fi beats | koto, japanese, lofi, chill, beats
tibetan singing bowls with deep drone | singing bowls, drone, meditation, calm, tibetan
meditative handpan with soft rain | handpan, hang drum, rain, meditative, calm
sparse piano with distant reverb | piano, sparse, reverb, calm, minimal, keys
warm cello and piano duet | cello, piano, duet, warm, classical, keys
baroque harpsichord and string ensemble | baroque, harpsichord, strings, classical, elegant, keys
minimalist piano arpeggios with strings | minimalist, piano, arpeggio, strings, cinematic, keys
romantic waltz for strings and harp | waltz, strings, harp, romantic, 3/4
epic choir with brass and timpani | choir, brass, timpani, epic, orchestral
haunting music box with eerie strings | music box, eerie, strings, haunting, horror
tense horror drones with dissonant strings | horror, drone, dissonant, strings, tense
noir jazz with muted trumpet and brushed drums | noir, jazz, trumpet, brushes, smoky
spaghetti western with whistling and twangy guitar | western, whistle, guitar, twang, cinematic
space ambient with arpeggiated analog synths | space, ambient, analog, arpeggio, cosmic, synth
lo-fi jazz guitar with rain ambience | lofi, jazz, guitar, rain, chill
sunny tropical house with steel drums | tropical house, steel drums, summer, house, sunny
psychedelic rock with fuzz guitar and organ | psychedelic, rock, fuzz, organ, 60s, keys
garage punk with raw drums and distorted guitar | punk, garage, raw, distorted, energetic, guitar
smooth r&b slow jam with silky keys | r&b, rnb, slow jam, keys, smooth
trap beat with dark piano and 808s | trap, piano, 808, dark, hip hop, keys
boom bap beat with jazzy horn samples | boom bap, hip hop, jazz, horns, sample, beats
g-funk groove with high synth lead | g-funk, hip hop, synth, west coast, groove
electro swing with brass and chopped samples | electro swing, brass, swing, samples, dance
big band swing with roaring brass | big band, swing, brass, jazz, energetic
gypsy jazz with fast acoustic guitar and violin | gypsy jazz, guitar, violin, swing, acoustic, strings
latin jazz with congas and piano montuno | latin jazz, congas, piano, montuno, salsa, keys
tango with bandoneon and dramatic strings | tango, bandoneon, strings, dramatic, argentine
polka band with accordion and tuba | polka, accordion, tuba, oompah, festive
balkan brass band in fast 7/8 | balkan, brass, 7/8, odd meter, fast
industrial techno with metallic percussion | techno, industrial, metallic, dark, club
minimal techno with clicky percussion and deep bass | techno, minimal, clicks, deep, hypnotic
dub techno chords with deep echo | dub techno, chords, echo, deep, hypnotic
glitchy idm with granular textures | idm, glitch, granular, experimental, electronic
breakcore chaos with chopped breaks | breakcore, chaotic, breakbeat, fast, experimental
witch house with dark choir pads | witch house, dark, choir, pads, eerie
math rock with tapped guitars and odd meters | math rock, guitar, tapping, odd meter, intricate
uplifting gospel choir with hammond organ | gospel, choir, organ, uplifting, church, keys
country ballad with pedal steel and piano | country, ballad, pedal steel, piano, slow, keys
`;

function shelf(category: string, block: string): LibraryEntry[] {
  const entries: LibraryEntry[] = [];
  for (const line of block.split("\n")) {
    const [text, tags] = line.split(" | ");
    if (text?.trim()) {
      entries.push({
        category,
        tags: (tags ?? "").split(", ").filter(Boolean),
        text: text.trim(),
      });
    }
  }
  return entries;
}

export const LIBRARY_PROMPTS: LibraryEntry[] = [
  ...shelf("genres", GENRES),
  ...shelf("instruments", INSTRUMENTS),
  ...shelf("rhythm", RHYTHM),
  ...shelf("moods", MOODS),
  ...shelf("textures", TEXTURES),
  ...shelf("world", WORLD),
  ...shelf("cinematic", CINEMATIC),
  ...shelf("eras", ERAS),
  ...shelf("combos", COMBOS),
];

export const LIBRARY_BLENDS: LibraryBlend[] = [
  {
    description:
      "Dusty beats and warm electric piano for studying after midnight.",
    drums: "auto",
    name: "Late night lo-fi",
    noteMode: "jam",
    prompts: [
      ["lo-fi hip hop beat", 0.7],
      ["warm rhodes electric piano", 0.5],
      ["vinyl crackle", 0.25],
    ],
  },
  {
    description: "Soulful four-on-the-floor house with jazzy chords.",
    drums: "on",
    name: "Deep house sunrise",
    noteMode: "jam",
    prompts: [
      ["deep house groove", 0.8],
      ["warm rhodes electric piano", 0.4],
      ["sub bass", 0.25],
    ],
  },
  {
    description: "Pounding industrial techno for a dark room.",
    drums: "on",
    name: "Warehouse techno",
    noteMode: "jam",
    prompts: [
      ["industrial techno", 0.8],
      ["metallic industrial percussion", 0.4],
      ["hypnotic", 0.3],
    ],
  },
  {
    description: "Squelchy 303 lines over a classic drum machine.",
    drums: "on",
    name: "Acid rave",
    noteMode: "jam",
    prompts: [
      ["acid house", 0.8],
      ["acid 303 bassline", 0.6],
      ["909 drum machine", 0.35],
    ],
  },
  {
    description: "Rolling arpeggios and big supersaw lift.",
    drums: "on",
    name: "Euphoric trance",
    noteMode: "jam",
    prompts: [
      ["uplifting trance", 0.8],
      ["trance arpeggiated synth", 0.5],
      ["euphoric", 0.3],
    ],
  },
  {
    description: "Smooth fast breaks under lush pads.",
    drums: "on",
    name: "Liquid rollers",
    noteMode: "jam",
    prompts: [
      ["liquid drum and bass", 0.8],
      ["lush strings", 0.3],
      ["warm analog pads", 0.3],
    ],
  },
  {
    description: "Retro synthwave cruising with an analog lead.",
    drums: "auto",
    name: "Neon night drive",
    noteMode: "jam",
    prompts: [
      ["synthwave", 0.8],
      ["retro synthwave analog lead", 0.5],
      ["gated reverb drums", 0.3],
    ],
  },
  {
    description: "Piano trio with walking bass and brushes.",
    drums: "auto",
    name: "Jazz club trio",
    noteMode: "jam",
    prompts: [
      ["jazz piano trio", 0.9],
      ["walking upright bass", 0.4],
      ["brushed jazz drums", 0.3],
    ],
  },
  {
    description: "Slow detective jazz under a muted trumpet.",
    drums: "auto",
    name: "Smoky noir",
    noteMode: "jam",
    prompts: [
      ["dark jazz", 0.7],
      ["muted trumpet", 0.5],
      ["film noir jazz", 0.4],
    ],
  },
  {
    description: "Gentle Brazilian groove with nylon guitar and flute.",
    drums: "auto",
    name: "Bossa beach",
    noteMode: "jam",
    prompts: [
      ["smooth bossa nova", 0.8],
      ["nylon string classical guitar", 0.4],
      ["flute", 0.2],
    ],
  },
  {
    description: "Interlocking percussion and a punchy horn section.",
    drums: "on",
    name: "Afrobeat horns",
    noteMode: "jam",
    prompts: [
      ["afrobeat", 0.8],
      ["horn section", 0.5],
      ["polyrhythmic percussion", 0.3],
    ],
  },
  {
    description: "Log drum bass, shakers and jazzy keys.",
    drums: "on",
    name: "Amapiano sunset",
    noteMode: "jam",
    prompts: [
      ["amapiano", 0.8],
      ["smooth piano chords", 0.35],
      ["shaker groove", 0.25],
    ],
  },
  {
    description: "Laid-back one drop with skanking guitar and organ.",
    drums: "auto",
    name: "Roots reggae yard",
    noteMode: "jam",
    prompts: [
      ["roots reggae", 0.8],
      ["reggae rhythm guitar", 0.4],
      ["hammond organ", 0.25],
    ],
  },
  {
    description: "Heavy bass and melodica swimming in tape echo.",
    drums: "auto",
    name: "Dub chamber",
    noteMode: "jam",
    prompts: [
      ["dub", 0.8],
      ["tape delay", 0.4],
      ["melodica", 0.3],
    ],
  },
  {
    description: "Tight drums, slap bass, wah guitar and horns.",
    drums: "on",
    name: "70s funk band",
    noteMode: "jam",
    prompts: [
      ["funk", 0.8],
      ["wah wah guitar", 0.4],
      ["horn section", 0.3],
      ["slap bass", 0.3],
    ],
  },
  {
    description: "Four on the floor with sweeping strings.",
    drums: "on",
    name: "Mirrorball disco",
    noteMode: "jam",
    prompts: [
      ["disco", 0.8],
      ["lush strings", 0.35],
      ["funky bass guitar", 0.35],
    ],
  },
  {
    description: "Washed-out guitars stacked into a wall of sound.",
    drums: "auto",
    name: "Shoegaze haze",
    noteMode: "jam",
    prompts: [
      ["shoegaze", 0.8],
      ["wall of sound", 0.4],
      ["dreamy", 0.3],
    ],
  },
  {
    description: "Tremolo guitars building toward a crescendo.",
    drums: "auto",
    name: "Post-rock swell",
    noteMode: "jam",
    prompts: [
      ["post-rock", 0.8],
      ["tremolo guitar", 0.4],
      ["cavernous endless reverb electric guitar swells", 0.25],
    ],
  },
  {
    description: "Slow, heavy fuzz riffs.",
    drums: "auto",
    name: "Stoner doom",
    noteMode: "jam",
    prompts: [
      ["doom metal", 0.7],
      ["fuzz guitar", 0.5],
      ["stoner rock", 0.4],
    ],
  },
  {
    description: "Fast palm-muted riffs and relentless drums.",
    drums: "on",
    name: "Thrash attack",
    noteMode: "jam",
    prompts: [
      ["thrash metal", 0.9],
      ["chugging metal guitar riffs", 0.4],
      ["relentless", 0.2],
    ],
  },
  {
    description: "Beatless warm pads with a shimmering tail.",
    drums: "off",
    name: "Ambient drift",
    noteMode: "jam",
    prompts: [
      ["ambient", 0.8],
      ["warm analog pads", 0.5],
      ["shimmer reverb", 0.3],
    ],
  },
  {
    description: "Slow cosmic drones and distant analog arpeggios.",
    drums: "off",
    name: "Deep space",
    noteMode: "jam",
    prompts: [
      ["space ambient", 0.8],
      ["drone", 0.4],
      ["arpeggiated analog synth", 0.25],
    ],
  },
  {
    description: "Just a piano that plays the notes you hold.",
    drums: "off",
    name: "Solo grand piano",
    noteMode: "solo",
    prompts: [
      ["grand piano", 1.0],
      ["intimate", 0.25],
    ],
  },
  {
    description: "Soft muted piano with tape warmth.",
    drums: "off",
    name: "Felt piano lullaby",
    noteMode: "solo",
    prompts: [
      ["felt piano", 0.9],
      ["lullaby", 0.35],
      ["tape hiss", 0.2],
    ],
  },
  {
    description: "A single bowed cello in a big room.",
    drums: "off",
    name: "Cello in the hall",
    noteMode: "solo",
    prompts: [
      ["classical cello", 1.0],
      ["cathedral reverb", 0.3],
    ],
  },
  {
    description: "A warm electric piano voice for your own chords.",
    drums: "off",
    name: "Rhodes keys",
    noteMode: "solo",
    prompts: [
      ["rhodes electric piano", 1.0],
      ["warm analog saturation", 0.2],
    ],
  },
  {
    description: "Classical guitar that follows your keyboard.",
    drums: "off",
    name: "Nylon guitar solo",
    noteMode: "solo",
    prompts: [
      ["nylon string classical guitar", 0.9],
      ["intimate", 0.3],
    ],
  },
  {
    description: "A retro synth lead voice to play melodies on.",
    drums: "off",
    name: "Analog lead",
    noteMode: "solo",
    prompts: [
      ["retro synthwave analog lead", 0.9],
      ["analog synth", 0.4],
    ],
  },
  {
    description: "Thumb piano with birdsong and a calm mood.",
    drums: "off",
    name: "Kalimba garden",
    noteMode: "jam",
    prompts: [
      ["african kalimba", 0.8],
      ["forest birdsong ambience", 0.3],
      ["peaceful", 0.3],
    ],
  },
  {
    description: "Sitar and tabla over a tanpura drone.",
    drums: "auto",
    name: "Raga dawn",
    noteMode: "jam",
    prompts: [
      ["indian classical sitar and tabla raga", 0.8],
      ["tanpura drone", 0.4],
      ["meditative", 0.2],
    ],
  },
  {
    description: "Middle Eastern groove with breathy ney flute.",
    drums: "auto",
    name: "Oud and darbuka",
    noteMode: "jam",
    prompts: [
      ["middle eastern oud and darbuka groove", 0.8],
      ["ney flute", 0.3],
      ["qanun", 0.25],
    ],
  },
  {
    description: "Metallic gamelan shimmer floating on soft pads.",
    drums: "off",
    name: "Gamelan dream",
    noteMode: "jam",
    prompts: [
      ["balinese gamelan metallic percussion", 0.7],
      ["ambient pad synthesizer", 0.4],
      ["dreamy", 0.3],
    ],
  },
  {
    description: "Pub session fiddle jig with whistle and bodhran.",
    drums: "auto",
    name: "Celtic session",
    noteMode: "jam",
    prompts: [
      ["celtic fiddle jig", 0.8],
      ["tin whistle", 0.4],
      ["bodhran", 0.3],
    ],
  },
  {
    description: "Rasgueado guitar with palmas and cajon.",
    drums: "auto",
    name: "Flamenco fire",
    noteMode: "jam",
    prompts: [
      ["flamenco nylon guitar rasgueado", 0.8],
      ["flamenco palmas and cajon", 0.35],
      ["passionate", 0.2],
    ],
  },
  {
    description: "Orchestral hits, taiko and choir for the big moment.",
    drums: "auto",
    name: "Epic trailer",
    noteMode: "jam",
    prompts: [
      ["epic trailer music", 0.8],
      ["taiko drums", 0.4],
      ["wordless choir", 0.3],
    ],
  },
  {
    description: "Dissonant strings creeping over a low drone.",
    drums: "off",
    name: "Horror corridor",
    noteMode: "jam",
    prompts: [
      ["horror soundtrack", 0.7],
      ["tremolo strings", 0.4],
      ["ominous drone", 0.4],
    ],
  },
  {
    description: "Bright chiptune melodies for a pixel quest.",
    drums: "auto",
    name: "8-bit adventure",
    noteMode: "jam",
    prompts: [
      ["chiptune", 0.9],
      ["16-bit rpg town theme", 0.35],
      ["square wave lead", 0.3],
    ],
  },
  {
    description: "Light pizzicato and bells for a peaceful game town.",
    drums: "auto",
    name: "Cozy village",
    noteMode: "jam",
    prompts: [
      ["cozy village game music", 0.8],
      ["pizzicato strings", 0.3],
      ["glockenspiel", 0.3],
    ],
  },
  {
    description: "Dusty 90s drums and chopped jazz samples.",
    drums: "on",
    name: "Boom bap cypher",
    noteMode: "jam",
    prompts: [
      ["boom bap", 0.8],
      ["dusty sample chops", 0.4],
      ["upright bass", 0.2],
    ],
  },
  {
    description: "The official app's wildest suggestion, pushed toward neon.",
    drums: "auto",
    name: "Cyberpunk mariachi",
    noteMode: "jam",
    prompts: [
      ["cyberpunk synthwave mariachi horns", 0.8],
      ["cyberpunk city", 0.3],
      ["mariachi", 0.25],
    ],
  },
];
