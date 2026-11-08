"""Creatures and titans (spec §4-5): the same insect physics, bigger. Spiders pad and brush, beetles clack hollow and
woody, centipedes ripple, mantises swish and snap; titans are the same sounds much bigger and lower (the game also
plays them slower by body length), with a creak or scrape before a slam. Research: docs/audio/sound-research.md.
"""
import numpy as np

from dsp import (SR, add, body_ir, brown, bubbles, burst, click, creak, crunch, env_points, friction, grains, hiss, hp,
                 lp, modes, norm, ring, squelch, stridulate, swish, thud, tlin, train, impulses, zeros, bp, seamless, soft_clip)
from recipes_combat import squeak, twitch
from registry import sound


def pad(r, f=900, dec=0.012):
    """A spider's padded foot (scopulae: dense hair tufts) meeting the ground, with a brush of hairs."""
    n = int((dec * 7 + 0.02) * SR)
    x = lp(r.noise(n) * np.exp(-tlin(n) / dec) * np.minimum(1, tlin(n) / 0.002), f, 2)
    h = hp(r.noise(int(0.012 * SR)) * np.exp(-tlin(int(0.012 * SR)) / 0.004), 5000)
    o = norm(x)
    o[: len(h)] += 0.12 * norm(h)
    return o


@sound("cr.spider_step", takes=6, lufs=-24)
def spider_step(r, k):
    # a wolf spider's steps: soft, padded footfalls with a brush of hairs (spiders are nearly silent walkers)
    o = zeros(0.1)
    add(o, pad(r, r.u(700, 1200), r.u(0.008, 0.014)), 0.001, 1.0)
    add(o, pad(r, r.u(700, 1200), r.u(0.006, 0.012)), r.u(0.015, 0.035), r.u(0.4, 0.8))
    return o


@sound("cr.spider_pounce", takes=4)
def spider_pounce(r, k):
    # a pounce: legs scraping as they push off, a small rush of air, a padded landing with grains
    o = zeros(0.45)
    add(o, norm(friction(r, 0.06, 900, 1500, 6000, (0.0005, 0.003), 0.3)), 0.001, 0.6)
    add(o, swish(r, r.u(0.12, 0.18), 500, 2200, 2.0), 0.03, 0.35)
    land = r.u(0.17, 0.24)
    add(o, pad(r, 1000, 0.015), land, 1.0)
    add(o, pad(r, 1100, 0.01), land + 0.012, 0.6)
    add(o, grains(r, 0.06, r.i(5, 9), 2000, 7000, (0.0005, 0.002), 1.5), land + 0.004, 0.35)
    return o


@sound("cr.spider_fangs", takes=4)
def spider_fangs(r, k):
    # a spider's bite: a soft scrape of the strike, then the fangs going in: a wet tick
    o = zeros(0.14)
    add(o, norm(friction(r, 0.03, 800, 1500, 6000, (0.0005, 0.003), 0.3)), 0.001, 0.4)
    add(o, click(r, 2500, 8000, 3, (0.0008, 0.004), 0.7), 0.025, 1.0)
    add(o, squelch(r, 0.035, 2600, 1100, 6), 0.027, 0.5)
    add(o, bubbles(r, 0.03, r.i(2, 4), 1800, 4500, (0.0015, 0.004)), 0.03, 0.3)
    return o


@sound("cr.beetle_step", takes=6, lufs=-23)
def beetle_step(r, k):
    # a ground beetle's steps: a heavy armoured body planting each foot: a low, dull footfall on packed soil with only
    # a hint of claw (a thud, not a clack)
    o = zeros(0.1)
    add(o, thud(r, r.u(170, 260), r.u(0.012, 0.02)), 0.001, 1.0)
    add(o, lp(click(r, 700, 2200, 3, (0.001, 0.004), 0.3), 2500), r.u(0.002, 0.006), 0.22)
    if r.chance(0.6):
        add(o, thud(r, r.u(200, 300), r.u(0.008, 0.014)), r.u(0.018, 0.035), r.u(0.35, 0.6))
    add(o, lp(grains(r, 0.03, r.i(1, 3), 900, 2600, (0.0003, 0.001)), 3000), 0.004, 0.12)
    return lp(o, 4500)


def hollow(r, f_lo, f_hi, dec=(0.008, 0.03), n=5):
    """A hollow, woody clack: a closed shell (a beetle's head, elytra) ringing a little longer."""
    ir = body_ir(r, f_lo, f_hi, n, dec)
    b = lp(burst(r, 0.003, 0.00005, 0.0006), 9000)
    return norm(ring(b, ir))


@sound("cr.beetle_bite", takes=5)
def beetle_bite(r, k):
    # a beetle's mandibles: a deep, hollow clack of the two jaws meeting, the whole head capsule booming low, with a
    # low crunch as they bite down (bass under the woody knock, the transient still crisp)
    o = zeros(0.2)
    add(o, hollow(r, 320, 1500, (0.01, 0.035), 5), 0.001, 1.0)
    add(o, hollow(r, 380, 1700, (0.008, 0.025), 4), r.u(0.005, 0.012), r.u(0.5, 0.8))
    add(o, thud(r, r.u(110, 160), r.u(0.03, 0.045)), 0.001, 0.8)
    add(o, lp(crunch(r, 0.04, r.i(5, 9), 2400, 900, 2.0, (0.0008, 0.004)), 3500), 0.004, 0.4)
    add(o, hp(norm(burst(r, 0.006, 0.0001, 0.0012)), 2500), 0.001, 0.3)
    return lp(o, 7000)


@sound("cr.beetle_elytra", takes=3)
def beetle_elytra(r, k):
    # wing cases snapping open, the hind wings unfolding with a crinkle, a brief buzz of the wings trying
    o = zeros(0.55)
    add(o, hollow(r, 1200, 4500, (0.005, 0.02)), 0.001, 1.0)
    add(o, hollow(r, 1200, 4500, (0.005, 0.02)), r.u(0.01, 0.025), 0.8)
    add(o, norm(friction(r, 0.18, 1500, 3000, 10000, (0.0003, 0.0012), 0.3)), 0.04, 0.4)
    n = int(0.22 * SR)
    f = r.u(70, 95)
    wing = np.sign(np.sin(2 * np.pi * f * tlin(n))) * np.sin(np.pi * np.linspace(0, 1, n)) ** 2
    add(o, bp(wing, 150, 3000), 0.25, 0.25)
    return o


@sound("cr.stag_clash", takes=5)
def stag_clash(r, k):
    # stag beetle mandibles clashing: a heavy ringing clack, then the jaws scraping as they lock and twist
    o = zeros(0.35)
    add(o, hollow(r, 600, 2600, (0.015, 0.05), 6), 0.001, 1.0)
    add(o, hollow(r, 650, 2800, (0.012, 0.04), 5), r.u(0.006, 0.014), 0.7)
    add(o, norm(friction(r, r.u(0.15, 0.22), 600, 1200, 5000, (0.001, 0.006), 0.3)), 0.06, 0.45)
    return o


@sound("cr.centipede_patter", takes=5, lufs=-23)
def centipede_patter(r, k):
    # a centipede running: dozens of legs in waves (metachronal), a rippling patter; the claws tick low on the soil
    # and the long body drums a faint low-mid rumble under them
    dur = r.u(0.22, 0.32)
    o = zeros(dur + 0.04)
    wave = r.u(14, 22)
    for t in train(r, dur, r.u(160, 260), None, 0.25):
        g = 0.45 + 0.55 * np.sin(np.pi * wave * t) ** 2
        add(o, click(r, 800, 3200, 3, (0.0008, 0.003), 0.4), t, g * r.u(0.4, 1))
        if r.chance(0.5):
            add(o, thud(r, r.u(220, 360), r.u(0.004, 0.008)), t + 0.0005, g * r.u(0.3, 0.7))
    return lp(o, 5500)


@sound("cr.centipede_bite", takes=4)
def centipede_bite(r, k):
    # a centipede's strike: a rattling ripple of legs surging, then the forcipules snapping in with a wet tick
    o = zeros(0.22)
    L = r.u(0.06, 0.09)
    for t in train(r, L, 220, 380, 0.2):
        add(o, click(r, 2200, 8000, 2, (0.0004, 0.002), 0.5), t, (t / L) * r.u(0.4, 1))
    add(o, click(r, 2000, 8000, 4, (0.001, 0.005), 1.0), L + 0.002, 1.0)
    add(o, squelch(r, 0.04, 2400, 1000, 6), L + 0.004, 0.4)
    return o


@sound("cr.mantis_sway", takes=3, lufs=-26)
def mantis_sway(r, k):
    # a mantis swaying in wait: a very quiet rustle of tarsi shifting on a leaf
    o = zeros(0.7)
    add(o, norm(friction(r, r.u(0.45, 0.6), 120, 1800, 7000, (0.0005, 0.003), 0.5)), 0.01, 1.0)
    return lp(o, 9000)


@sound("cr.mantis_strike", takes=5)
def mantis_strike(r, k):
    # a mantis strike: a quick swish of the raptorial legs (one of the fastest strikes among insects) and a snap as
    # the spined tibia folds shut
    # (the swish is short and soft: the sound starts with the strike, so the snap lands on the strike frame)
    o = zeros(0.22)
    add(o, swish(r, r.u(0.02, 0.03), 1200, 4000, 2.2), 0.001, 0.4)
    t = r.u(0.012, 0.02)
    add(o, click(r, 2000, 8000, 4, (0.001, 0.005), 1.0), t, 1.0)
    add(o, crunch(r, 0.03, r.i(5, 9), 7000, 2500, 2.0), t + 0.002, 0.45)
    return o


def plate(r, f, amp, ring=0.005):
    """One armour plate clicking shut (the old stand-in's chitin knock): a near-harmonic mode stack over a short
    contact burst, and the plate's body knocking low."""
    d = ring * 0.45
    fs = [f, f * r.u(1.5, 1.8), f * r.u(2.3, 2.7), f * r.u(3.2, 3.8)]
    m = modes(ring * 3, fs, [d, d * 0.7, d * 0.5, d * 0.35], [1, 0.75, 0.55, 0.3], [r.u(0, 6.28) for _ in fs])
    b = hp(burst(r, 0.005, 0.0002, 0.0015), 1800)
    o = np.zeros(max(len(m), len(b)))
    o[: len(m)] += norm(m)
    o[: len(b)] += 0.6 * norm(b)
    return amp * o


@sound("cr.pillbug_roll", takes=3)
def pillbug_roll(r, k):
    # a pill woodlouse rolling up: its plates knocking closed one after another, each a little lower and quieter as
    # the ball tightens (the old stand-in's even plate-by-plate knock, pitched down with a low body under it)
    o = zeros(0.35)
    n = r.i(5, 7)
    f = r.u(1000, 1300)
    t = 0.003
    for i in range(n):
        add(o, plate(r, f - i * 70, 0.75 - i * 0.06, 0.006), t, 1.0)
        add(o, thud(r, r.u(180, 260), 0.008), t, 0.35 - i * 0.03)
        t += r.u(0.02, 0.035)
    return lp(o, 6000)


@sound("cr.caterpillar_crawl", takes=3, lufs=-24)
def caterpillar_crawl(r, k):
    # a cutworm crawling: soft prolegs letting go and gripping, squishy and quiet; no edges, just damp little pulls
    o = zeros(0.5)
    t = 0.01
    while t < 0.4:
        n = int(r.u(0.04, 0.07) * SR)
        sq = squelch(r, n / SR, r.u(600, 1000), r.u(250, 450), r.u(1.5, 2.5))
        sq *= np.sin(np.pi * np.linspace(0, 1, len(sq))) ** 1.5
        add(o, norm(sq), t, r.u(0.5, 1))
        t += r.u(0.07, 0.12)
    add(o, norm(lp(friction(r, 0.4, 50, 500, 1800, (0.001, 0.004), 0.6), 1500)), 0.02, 0.15)
    return lp(o, 2800, 4)


@sound("cr.antlion_flick", takes=4)
def antlion_flick(r, k):
    # an antlion flicking sand at its prey: a jerk of the head and a spray of grains pattering down
    o = zeros(0.45)
    add(o, swish(r, 0.04, 1500, 5000, 2.0), 0.001, 0.4)
    add(o, grains(r, 0.08, r.i(30, 50), 3000, 10000, (0.0002, 0.001), 1.2, (0.1, 0.6)), 0.01, 0.8)
    add(o, grains(r, 0.25, r.i(20, 35), 2500, 9000, (0.0003, 0.0012), 1.0, (0.05, 0.4)), 0.12, 0.6)
    return o


# ------------------------------------------------------------------ deaths


def squeal(r, chirps, f_lo, f_hi, rate, clen, gap=(0.02, 0.05), fall=0.8, slow=0.8, dec=(0.0003, 0.0014), body_n=3):
    """A dying stridulation: a few strokes of the file, each lower, slower and weaker than the last, as the body gives
    out (the "animal" voice of an arthropod: there is no larynx, only a scraper losing its rhythm)."""
    o = zeros(chirps * (clen[1] + gap[1]) + 0.1)
    t = 0.002
    for i in range(chirps):
        fl = f_lo * fall ** i
        fh = f_hi * fall ** i
        rt = (rate[0] * slow ** i, rate[1] * slow ** i)
        L = r.u(*clen) * (1 + 0.15 * i)
        c = stridulate(r, 1, fl, fh, dec, (0.0, 0.0), (L, L), rt, 0.35, body_n)
        add(o, norm(c), t, (0.95 ** i) * r.u(0.7, 1.0))
        t += L + r.u(*gap)
    return o


def collapse(r, o, t, f=160, dec=0.03, g=0.5, legs=(1800, 7000), n=8, span=0.25):
    """The body dropping and the legs' last twitches."""
    add(o, thud(r, f * r.u(0.9, 1.1), dec), t, g)
    twitch(r, o, t + 0.02, span, n, legs[0], legs[1], 0.3)


@sound("cr.death_spider", takes=3, lufs=-17.8)
def death_spider(r, k):
    # a spider dying: a shrill, fast squeal of the chelicerae's file (a katydid-quick tooth train) falling apart, the
    # legs curling in with little ticks, and the soft body folding onto the soil
    o = zeros(0.9)
    add(o, click(r, 1500, 5000, 3, (0.001, 0.004), 0.7), 0.001, 0.6)
    add(o, squeal(r, r.i(3, 4), 6500, 14000, (2000, 3000), (0.06, 0.1), (0.015, 0.04), 0.82, 0.78, (0.0002, 0.0008)), 0.01, 1.0)
    for i in range(r.i(6, 10)):
        t = 0.3 + 0.4 * r.u() ** 1.3
        add(o, click(r, 2500, 8000, 2, (0.0005, 0.002), 0.6), t, r.u(0.2, 0.6) * (1 - (t - 0.3) / 0.5))
    add(o, pad(r, r.u(500, 800), 0.03), r.u(0.42, 0.55), 0.7)
    return o


@sound("cr.death_beetle", takes=3, lufs=-17.8)
def death_beetle(r, k):
    # a beetle dying: the shell cracking deep, a low groaning stridulation (the abdomen rasping against the elytra,
    # slowing to a stop), and the armoured body dropping heavily
    o = zeros(1.05)
    add(o, hollow(r, 300, 1400, (0.01, 0.03), 5), 0.001, 0.9)
    add(o, lp(crunch(r, 0.09, r.i(16, 26), 2200, 600, 2.0, (0.001, 0.005)), 3500), 0.002, 0.8)
    add(o, lp(squeal(r, r.i(2, 3), 350, 1400, (120, 200), (0.14, 0.22), (0.04, 0.08), 0.85, 0.7, (0.002, 0.008), 4), 3500), 0.06, 0.9)
    collapse(r, o, r.u(0.5, 0.65), 120, 0.045, 1.0, (900, 3500), 5, 0.25)
    return lp(o, 5000)


@sound("cr.death_centipede", takes=3, lufs=-17.8)
def death_centipede(r, k):
    # a centipede dying: the legs' rattle racing then faltering, wave by wave, to nothing, under a sharp hiss of air
    # forced from the spiracles; the long body slaps down
    o = zeros(0.95)
    L = r.u(0.45, 0.6)
    for t in train(r, L, r.u(260, 340), r.u(40, 70), 0.3):
        u = t / L
        add(o, click(r, 900, 4000, 3, (0.0006, 0.0025), 0.5), t, r.u(0.4, 1) * (1 - 0.6 * u))
    add(o, norm(hiss(r, 0.3, 2500, 7000, [(0, 0), (0.01, 1), (0.3, 0)])), 0.01, 0.45)
    add(o, squeal(r, 2, 2500, 7000, (900, 1400), (0.05, 0.08), (0.02, 0.04), 0.8, 0.7), 0.04, 0.5)
    collapse(r, o, L + r.u(0.02, 0.06), 180, 0.03, 0.8, (1200, 4500), 6, 0.2)
    return o


@sound("cr.death_mantis", takes=3, lufs=-17.8)
def death_mantis(r, k):
    # a mantis dying: a dry, raspy shriek of the wings rubbed against the abdomen (the threat rasp, one last time),
    # the raptorial legs snapping shut on nothing, and the long body folding
    o = zeros(0.9)
    add(o, squeal(r, r.i(2, 3), 2000, 6500, (450, 750), (0.1, 0.16), (0.02, 0.05), 0.8, 0.75, (0.0004, 0.0016), 4), 0.005, 1.0)
    add(o, norm(friction(r, 0.28, 900, 2000, 7000, (0.0003, 0.0012), 0.15)), 0.01, 0.4)
    ts = r.u(0.3, 0.42)
    add(o, click(r, 1800, 7000, 4, (0.001, 0.005), 1.0), ts, 0.9)
    add(o, crunch(r, 0.03, r.i(5, 9), 6000, 2000, 2.0), ts + 0.002, 0.4)
    collapse(r, o, ts + r.u(0.08, 0.15), 200, 0.025, 0.6, (1500, 6000), 5, 0.25)
    return o


@sound("cr.death_soft", takes=3, lufs=-17.8)
def death_soft(r, k):
    # a soft-bodied creature dying (caterpillar, pill woodlouse, mole cricket, antlion): a wet squelch as the body
    # gives, a few bubbles of fluid, and a small, soft chirp fading out
    o = zeros(0.8)
    add(o, norm(squelch(r, 0.1, 1600, 500, 5)), 0.001, 0.9)
    add(o, lp(bubbles(r, 0.15, r.i(6, 10), 600, 2200, (0.003, 0.009)), 3500), 0.01, 0.6)
    add(o, thud(r, r.u(140, 200), 0.03), 0.004, 0.5)
    add(o, squeal(r, r.i(2, 3), 2200, 5500, (600, 1000), (0.05, 0.09), (0.03, 0.06), 0.8, 0.75), r.u(0.08, 0.15), 0.5)
    add(o, norm(squelch(r, 0.08, 900, 350, 4)), r.u(0.35, 0.5), 0.4)
    return lp(o, 6000)


@sound("cr.creature_death", takes=4, lufs=-17.8)
def creature_death(r, k):
    # a creature going down (the generic fall-back): a crack, a mid squeal of stridulation failing, the body slumping,
    # legs twitching
    o = zeros(0.85)
    add(o, click(r, 1200, 5000, 4, (0.002, 0.008), 0.9), 0.001, 1.0)
    add(o, lp(crunch(r, r.u(0.1, 0.15), r.i(25, 40), 3500, 900, 1.8, (0.0006, 0.004)), 5000), 0.002, 0.8)
    add(o, squeal(r, r.i(2, 3), 3000, 9000, (900, 1500), (0.06, 0.1), (0.02, 0.05), 0.8, 0.75), 0.02, 0.8)
    collapse(r, o, r.u(0.35, 0.45), 170, 0.035, 0.7, (1500, 6000), r.i(6, 10), 0.3)
    return o


@sound("cr.cricket_burrow", takes=3)
def cricket_burrow(r, k):
    # a mole cricket digging with its shovel legs: dry, close scoops of soil, each a dull shove and a scrabble of
    # grains falling off the legs (no air, no held tones: only dirt moving)
    o = zeros(0.55)
    t = 0.005
    for i in range(r.i(3, 5)):
        L = r.u(0.04, 0.07)
        add(o, thud(r, r.u(140, 220), r.u(0.012, 0.02)), t, 0.8)
        n = int(L * SR) + 1
        pr = np.sin(np.pi * np.linspace(0, 1, n)) ** 0.8
        add(o, norm(friction(r, L, 1800, 600, 2600, (0.0004, 0.0015), 0.0, pr, 3)), t + 0.004, 0.6)
        add(o, lp(grains(r, 0.07, r.i(10, 18), 1000, 4500, (0.0003, 0.0012), 1.3, (0.1, 0.6)), 5000), t + 0.02, 0.5)
        t += L + r.u(0.04, 0.07)
    return lp(o, 6000)


# ------------------------------------------------------------------ titans


def crust(r, dur, n, f0, f1, g=1.0):
    """Soil crust and cuticle breaking under a titan: a low crunch with no ringing partials (short, low resonances,
    lowpassed), so it reads as weight, not a plink."""
    return g * lp(crunch(r, dur, n, f0, f1, 2.0, (0.0004, 0.0016), 0.5, 1.4), 1800, 4)


def debris(r, dur, n, g=1.0, f=(250, 1100)):
    """Clods and soil falling after an impact: dull, lowpassed grains (no bright ticks)."""
    return g * lp(grains(r, dur, n, f[0], f[1], (0.0004, 0.0015), 1.8, (0.05, 0.5)), 1500, 4)


@sound("boss.footstep", takes=5)
def boss_footstep(r, k):
    # a titan's footfall: a huge tarsus planting (a dull snap of soil crust, no click), the ground taking the weight,
    # and clods trickling after; heavy, but still a step, not a drum
    o = zeros(1.0)
    add(o, lp(norm(burst(r, 0.02, 0.0002, 0.004)), 1600, 4), 0.001, 0.45)
    add(o, crust(r, 0.05, r.i(14, 22), 1200, 400), 0.002, 0.6)
    add(o, thud(r, r.u(55, 75), r.u(0.06, 0.09)), 0.001, 1.0)
    add(o, debris(r, 0.6, r.i(25, 40), 0.4), 0.06, 1.0)
    return lp(o, 3000)


@sound("boss.slam", takes=4)
def boss_slam(r, k):
    # a titan's slam: the body or jaws driving into the ground: a deep crack of crust and cuticle, a heavy impact, and
    # a shower of soil (an insect-scale catastrophe, not an explosion; nothing rings)
    o = zeros(2.0)
    add(o, lp(norm(burst(r, 0.03, 0.0002, 0.006)), 2000, 4), 0.001, 0.6)
    add(o, crust(r, 0.12, r.i(45, 70), 1400, 300), 0.002, 0.9)
    add(o, thud(r, r.u(42, 55), r.u(0.12, 0.16), 0.9), 0.001, 1.0)
    add(o, debris(r, 1.6, r.i(90, 140), 0.5, (200, 1000)), 0.08, 1.0)
    add(o, lp(brown(r, int(1.4 * SR)) * np.exp(-tlin(int(1.4 * SR)) / 0.35), 300), 0.0, 0.25)
    return lp(o, 3200)


@sound("boss.windup", takes=4)
def boss_windup(r, k):
    # the telegraph: a heavy joint loading up like a zip being drawn: a dense train of catches whose rate climbs as
    # the tension builds, ringing a big low body (the old stand-in's creak, lower and denser), over a low rub of the
    # cuticle plates sliding, no breath
    dur = r.u(0.7, 0.85)
    o = zeros(dur + 0.12)
    n = int(dur * SR) + 1
    ramp = env_points(n, [(0, 0.12), (dur * 0.65, 0.75), (dur, 1.0)])
    # the zip: fast catches, 60 -> 260 per second, each knocking a few low inharmonic modes
    z = creak(r, dur, r.u(55, 70), r.u(230, 290), 160, 1500, (0.002, 0.01), [(0, 0.1), (dur * 0.7, 0.85), (dur, 1.0)], 5)
    add(o, norm(lp(z, 4500)), 0.0, 1.0)
    # the slow creak of the joint itself underneath, 18 -> 45 like the old one, deeper
    c = creak(r, dur, r.u(16, 22), r.u(40, 50), 90, 450, (0.006, 0.02), [(0, 0.3), (dur, 1.0)], 4)
    add(o, norm(lp(c, 1200)), 0.0, 0.7)
    add(o, norm(lp(friction(r, dur, 500, 250, 1600, (0.001, 0.004), 0.2), 2000)) * ramp, 0.0, 0.3)
    return lp(o, 5000)


@sound("boss.phase", takes=3)
def boss_phase(r, k):
    # a titan enraged: no roar: a big, slow, rough stridulation (the old stand-in's 70-110 strokes a second, the body
    # ringing low) over a low hiss forced out of the spiracles and the ground shaking under it; deep and menacing
    o = zeros(1.5)
    f0 = r.u(260, 420)
    n = int(1.15 * SR) + 1
    ts = train(r, 1.15, r.u(70, 100), r.u(60, 85), 0.3)
    am = [np.sin(np.pi * min(1, t / 1.15)) ** 0.6 * r.u(0.6, 1) for t in ts]
    ir = body_ir(r, f0, f0 * 3.2, 5, (0.003, 0.012), -0.4)
    st = ring(impulses(r, 1.2, ts, am), ir)
    add(o, norm(lp(st, 2800)), 0.02, 1.0)
    add(o, norm(hiss(r, 1.2, 600, 2600, [(0, 0), (0.1, 1), (0.7, 0.6), (1.2, 0)])), 0.05, 0.4)
    add(o, thud(r, r.u(45, 55), 0.25), 0.01, 0.9)
    add(o, norm(lp(brown(r, n), 120)) * env_points(n, [(0, 0.2), (0.3, 1), (1.15, 0)]), 0.02, 0.5)
    return soft_clip(lp(o, 4000), 2.0)


@sound("boss.hairs", takes=3)
def boss_hairs(r, k):
    # a tarantula flicking urticating hairs: quick, dry brushing strokes of a hind leg over the abdomen
    o = zeros(0.65)
    t = 0.005
    for i in range(r.i(3, 5)):
        L = r.u(0.04, 0.07)
        add(o, norm(friction(r, L, 3000, 4000, 12000, (0.0002, 0.0008), 0.5)), t, r.u(0.6, 1))
        t += L + r.u(0.05, 0.09)
    return o


@sound("boss.arrive", takes=6)
def boss_arrive(r, k):
    # a titan arriving: takes 1-3 are distant footfalls getting closer under a rising rumble; takes 4-6 recreate the
    # old stand-in: five bare, deep thuds growing under a slow swell of low rumble (both kept, the game draws either)
    if k <= 3:
        dur = r.u(2.3, 2.8)
        o = zeros(dur + 0.6)
        steps = r.i(5, 7)
        for i in range(steps):
            t = 0.1 + i * dur / steps * r.u(0.9, 1.1)
            near = (i + 1) / steps
            st = boss_footstep(r, k)
            st = lp(st, 400 + 2600 * near ** 2)
            add(o, st, t, 0.2 + 0.8 * near ** 1.5)
        n = int(dur * SR)
        rum = norm(lp(brown(r, n), 160)) * np.linspace(0.05, 1, n) ** 1.5
        add(o, rum, 0.0, 0.3 * np.max(np.abs(o)))
        return o
    dur = 3.0
    o = zeros(dur)
    for i in range(5):
        add(o, thud(r, r.u(40, 55), 0.25), 0.2 + i * r.u(0.42, 0.52), 0.35 + i * 0.12)
    n = int(dur * SR)
    t = tlin(n)
    sw = np.minimum(1, t / dur / 0.6) * np.minimum(1, (dur - t) / 0.6)
    add(o, norm(lp(brown(r, n), 90, 2)) * sw, 0.0, 0.6)
    return soft_clip(o, 1.3)


@sound("boss.rumble", loop=True, lufs=-24, xf=2.0)
def boss_rumble(r, k):
    # a titan near: a low rumble felt through the soil, swelling slowly, with clods shaken loose now and then (dull,
    # no ticks)
    dur = 14.0
    n = int(dur * SR)
    t = tlin(n)
    sw = 0.6 + 0.4 * np.sin(2 * np.pi * t / 3.7 + r.u(0, 6)) * np.sin(2 * np.pi * t / 5.3 + r.u(0, 6))
    o = norm(lp(brown(r, n), 110, 3)) * sw
    o = o + 0.25 * norm(lp(brown(r, n), 400, 2)) * sw
    g = debris(r, dur, int(dur * 14), 1.0, (200, 900))[:n]
    return o + 0.1 * norm(g)
