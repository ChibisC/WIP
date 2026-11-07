"""Creatures and titans (spec §4-5): the same insect physics, bigger. Spiders pad and brush, beetles clack hollow and
woody, centipedes ripple, mantises swish and snap; titans are the same sounds much bigger and lower (the game also
plays them slower by body length), with a creak or scrape before a slam. Research: docs/audio/sound-research.md.
"""
import numpy as np

from dsp import (SR, add, body_ir, brown, bubbles, burst, click, creak, crunch, env_points, friction, grains, hiss, hp,
                 lp, modes, norm, ring, squelch, stridulate, swish, thud, tlin, train, impulses, zeros, bp, seamless)
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
    # a ground beetle's steps: armoured tarsi and claws clacking down, hard and quick
    o = zeros(0.07)
    for i in range(r.i(2, 3)):
        add(o, click(r, 1500, 5500, 4, (0.002, 0.008), 0.6), 0.001 + i * r.u(0.006, 0.015), r.u(0.5, 1))
    add(o, grains(r, 0.03, r.i(2, 4), 2500, 7000, (0.0004, 0.0015)), 0.004, 0.25)
    return o


def hollow(r, f_lo, f_hi, dec=(0.008, 0.03), n=5):
    """A hollow, woody clack: a closed shell (a beetle's head, elytra) ringing a little longer."""
    ir = body_ir(r, f_lo, f_hi, n, dec)
    b = lp(burst(r, 0.003, 0.00005, 0.0006), 9000)
    return norm(ring(b, ir))


@sound("cr.beetle_bite", takes=5)
def beetle_bite(r, k):
    # a beetle's mandibles: a woody, hollow clack, the two jaws meeting a hair apart
    o = zeros(0.14)
    add(o, hollow(r, 900, 3800), 0.001, 1.0)
    add(o, hollow(r, 1000, 4200, (0.006, 0.02), 4), r.u(0.004, 0.01), r.u(0.5, 0.8))
    add(o, crunch(r, 0.03, r.i(4, 8), 6000, 2500, 2.0), 0.004, 0.3)
    return o


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
    # a centipede running: dozens of legs in waves (metachronal), a rippling patter
    dur = r.u(0.22, 0.32)
    o = zeros(dur + 0.03)
    wave = r.u(14, 22)
    for t in train(r, dur, r.u(160, 260), None, 0.25):
        g = 0.45 + 0.55 * np.sin(np.pi * wave * t) ** 2
        add(o, click(r, 2000, 7500, 2, (0.0005, 0.0025), 0.5), t, g * r.u(0.4, 1))
    return o


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


@sound("cr.pillbug_roll", takes=3)
def pillbug_roll(r, k):
    # a pill woodlouse rolling up: its plates clicking closed one after another, faster at the end
    o = zeros(0.3)
    ts = np.cumsum([r.u(0.012, 0.03) * (1 - i / 12) for i in range(9)])
    for t in ts:
        add(o, hollow(r, 1800, 6000, (0.002, 0.007), 3), t, r.u(0.5, 1))
    return o


@sound("cr.caterpillar_crawl", takes=3, lufs=-24)
def caterpillar_crawl(r, k):
    # a cutworm crawling: soft prolegs letting go and gripping, squishy
    o = zeros(0.5)
    t = 0.01
    while t < 0.4:
        add(o, squelch(r, r.u(0.03, 0.06), r.u(900, 1600), r.u(400, 700), r.u(3, 5)), t, r.u(0.5, 1))
        t += r.u(0.06, 0.12)
    add(o, norm(friction(r, 0.4, 80, 1200, 4000, (0.001, 0.004), 0.5)), 0.02, 0.2)
    return lp(o, 7000)


@sound("cr.antlion_flick", takes=4)
def antlion_flick(r, k):
    # an antlion flicking sand at its prey: a jerk of the head and a spray of grains pattering down
    o = zeros(0.45)
    add(o, swish(r, 0.04, 1500, 5000, 2.0), 0.001, 0.4)
    add(o, grains(r, 0.08, r.i(30, 50), 3000, 10000, (0.0002, 0.001), 1.2, (0.1, 0.6)), 0.01, 0.8)
    add(o, grains(r, 0.25, r.i(20, 35), 2500, 9000, (0.0003, 0.0012), 1.0, (0.05, 0.4)), 0.12, 0.6)
    return o


@sound("cr.creature_death", takes=4)
def creature_death(r, k):
    # a creature going down: a heavier crunch, the body slumping, legs twitching
    o = zeros(0.65)
    add(o, click(r, 1500, 6000, 4, (0.002, 0.008), 0.9), 0.001, 1.0)
    add(o, crunch(r, r.u(0.12, 0.18), r.i(35, 50), 4500, 1100, 1.8, (0.0006, 0.004)), 0.002, 0.9)
    add(o, thud(r, r.u(160, 240), 0.03), r.u(0.12, 0.18), 0.35)
    twitch(r, o, 0.2, 0.35, r.i(8, 14), 1800, 7000, 0.35)
    return o


@sound("cr.cricket_burrow", takes=3)
def cricket_burrow(r, k):
    # a mole cricket digging with its shovel legs: rhythmic scoops of soil
    o = zeros(0.5)
    t = 0.005
    for i in range(r.i(3, 5)):
        add(o, norm(friction(r, r.u(0.04, 0.07), 700, 900, 4500, (0.0008, 0.004), 0.35)), t, 0.7)
        add(o, grains(r, 0.06, r.i(6, 12), 2000, 7000, (0.0004, 0.002), 1.3), t + 0.03, 0.5)
        t += r.u(0.08, 0.12)
    return o


# ------------------------------------------------------------------ titans


@sound("boss.footstep", takes=5)
def boss_footstep(r, k):
    # a titan's footfall: a huge tarsus and claws planting (a click and a crunch of soil crust), the ground taking the
    # weight, and debris trickling after; heavy, but still a step, not a drum
    o = zeros(1.0)
    add(o, click(r, 1200, 4500, 4, (0.002, 0.009), 0.8), 0.001, 0.55)
    add(o, crunch(r, 0.05, r.i(14, 22), 4000, 1200, 2.0, (0.0008, 0.004)), 0.003, 0.5)
    add(o, thud(r, r.u(55, 75), r.u(0.06, 0.09)), 0.001, 1.0)
    add(o, grains(r, 0.6, r.i(25, 40), 1500, 6000, (0.0006, 0.003), 1.8, (0.05, 0.5)), 0.06, 0.35)
    return o


@sound("boss.slam", takes=4)
def boss_slam(r, k):
    # a titan's slam: the body or jaws driving into the ground: a crack of crust and cuticle, a heavy impact, and a
    # shower of soil (an insect-scale catastrophe, not an explosion)
    o = zeros(2.0)
    add(o, click(r, 1000, 4000, 5, (0.003, 0.012), 1.0), 0.001, 0.7)
    add(o, crunch(r, 0.12, r.i(45, 70), 4500, 900, 2.0, (0.001, 0.005)), 0.002, 0.8)
    add(o, thud(r, r.u(42, 55), r.u(0.12, 0.16), 0.9), 0.001, 1.0)
    add(o, grains(r, 1.6, r.i(90, 140), 1200, 7000, (0.0006, 0.003), 1.9, (0.05, 0.6)), 0.08, 0.45)
    add(o, lp(brown(r, int(1.4 * SR)) * np.exp(-tlin(int(1.4 * SR)) / 0.35), 300), 0.0, 0.25)
    return o


@sound("boss.windup", takes=4)
def boss_windup(r, k):
    # the telegraph: a heavy joint creaking tighter and tighter, claws scraping for grip, before the strike
    dur = r.u(0.7, 0.85)
    o = zeros(dur + 0.1)
    c = creak(r, dur, r.u(28, 40), r.u(110, 160), 350, 2200, (0.004, 0.02), [(0, 0.1), (dur * 0.7, 0.8), (dur, 1.0)])
    add(o, norm(c), 0.0, 1.0)
    add(o, norm(friction(r, dur, 300, 900, 4500, (0.001, 0.005), 0.3)) * np.linspace(0.2, 1, int(dur * SR) + 1), 0.0, 0.35)
    return o


@sound("boss.phase", takes=3)
def boss_phase(r, k):
    # a titan enraged: a big, rough stridulation and a hiss (like a hissing beetle or cockroach forcing air out)
    o = zeros(1.4)
    add(o, norm(stridulate(r, r.i(3, 4), 600, 3200, (0.002, 0.008), (0.04, 0.09), (0.18, 0.28), (140, 260), 0.3, 5)), 0.01, 1.0)
    add(o, norm(hiss(r, 1.1, 2500, 9000, [(0, 0), (0.05, 1), (0.6, 0.7), (1.1, 0)])), 0.05, 0.45)
    return o


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


@sound("boss.arrive", takes=3)
def boss_arrive(r, k):
    # a titan arriving: distant footfalls getting closer under a rising rumble
    dur = r.u(2.3, 2.8)
    o = zeros(dur + 0.6)
    steps = r.i(5, 7)
    for i in range(steps):
        t = 0.1 + i * dur / steps * r.u(0.9, 1.1)
        near = (i + 1) / steps
        st = boss_footstep(r, k)
        st = lp(st, 400 + 3600 * near ** 2)
        add(o, st, t, 0.2 + 0.8 * near ** 1.5)
    n = int(dur * SR)
    rum = norm(lp(brown(r, n), 160)) * np.linspace(0.05, 1, n) ** 1.5
    add(o, rum, 0.0, 0.3 * np.max(np.abs(o)))
    return o


@sound("boss.rumble", loop=True, lufs=-24, xf=2.0)
def boss_rumble(r, k):
    # a titan near: a low rumble felt through the soil, swelling slowly, with grains shaken loose now and then
    dur = 14.0
    n = int(dur * SR)
    t = tlin(n)
    sw = 0.6 + 0.4 * np.sin(2 * np.pi * t / 3.7 + r.u(0, 6)) * np.sin(2 * np.pi * t / 5.3 + r.u(0, 6))
    o = norm(lp(brown(r, n), 110, 3)) * sw
    o = o + 0.25 * norm(lp(brown(r, n), 400, 2)) * sw
    g = grains(r, dur, int(dur * 14), 1200, 5000, (0.0006, 0.003), 1.0, (0.05, 0.3))[:n]
    return o + 0.12 * norm(g)
