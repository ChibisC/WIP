"""Attacks, hits and deaths (spec §4): insect-like, sized to the animal, built to land on the strike frame
(every one-shot starts within a few milliseconds of its file's start, so the contact is the first thing heard).
The base takes are sized for a ~4 mm worker; the game plays bigger animals slower (lower, fuller) by body length.
Research notes for each: docs/audio/sound-research.md.
"""
import numpy as np

from dsp import (SR, add, body_ir, bubble, bubbles, burst, click, creak, crunch, env_ad, env_points, fizz, friction, grains,
                 hiss, hp, impulses, lp, modes, norm, ring, squelch, stridulate, swish, thud, tlin, train, zeros, bp)
from registry import sound


def double_click(r, o, t, f_lo, f_hi, dec, sep=(0.003, 0.009), second=(0.45, 1.0), snap=0.5):
    """Two mandible tips meeting the target a few milliseconds apart."""
    add(o, click(r, f_lo, f_hi, 4, dec, snap), t, 1.0)
    add(o, click(r, f_lo * 0.9, f_hi * 0.9, 3, dec, snap * 0.8), t + r.u(*sep), r.u(*second))


def squeak(r, chirps=None, quiet=1.0, rate=(600, 1100), f=(3000, 9500)):
    """A held ant's distress stridulation: a few short strokes of the gaster's file (trapped ants stridulate)."""
    return quiet * norm(stridulate(r, chirps or r.i(2, 4), f[0], f[1], (0.0003, 0.0014), (0.025, 0.06), (0.04, 0.09), rate, 0.3))


def squeal(r, chirps=None, quiet=1.0):
    """A squeal: faster, shorter, harder-swept stridulation chirps (the file dragged fast under load), dry and close:
    the body is lower and dies quicker than squeak's, so it chirps instead of ringing."""
    return quiet * norm(stridulate(r, chirps or r.i(2, 4), 1800, 6500, (0.0002, 0.0008), (0.012, 0.035), (0.02, 0.05), (1300, 2400), 0.55, body_n=2))


def zipper(r, dur, catches=(1800, 3200), f=(1400, 5500)):
    """A zipper: a dense, even train of friction catches (claws dragged across sclerites) with no breathy rub and no
    slow swell; the pressure is a few quick jerks, so it reads as a zip being pulled, never as a wash."""
    n = int(dur * SR) + 1
    t = tlin(n)
    p = np.full(n, 0.55)
    for _ in range(r.i(2, 5)):
        c = r.u(0, dur)
        w = r.u(0.008, 0.03)
        p += r.u(0.5, 1) * np.exp(-((t - c) / w) ** 2)
    p = p / p.max()
    return norm(friction(r, dur, r.u(*catches), f[0], f[1], (0.0002, 0.0009), rub=0.03, pressure=p, body_n=3))


def body(r, f_lo, f_hi, dec=(0.004, 0.011), n=2):
    """The low-mid body of a bite: the head capsule and the bitten body thumping (150-600 Hz), a few milliseconds
    long so it adds weight without boom; a lowpassed contact burst gives it its front edge."""
    m = body_ir(r, f_lo, f_hi, n, dec)
    b = lp(burst(r, 0.006, 0.0001, 0.0015), f_hi * 2)
    o = np.zeros(max(len(m), len(b)))
    o[:len(m)] += norm(m)
    o[:len(b)] += 0.5 * norm(b)
    return norm(o)


# ------------------------------------------------------------------ bites


@sound("combat.mandible_click", takes=6)
def mandible_click(r, k):
    # a worker's bite: a dry, high double click of the mandible tips closing on chitin
    # (pass 2: deeper, the lightest of the bites still: the tips' modes a third lower and a touch of head-capsule
    # body under them, the grains kept crisp)
    o = zeros(0.045)
    double_click(r, o, 0.001, 2000, 7000, (0.0007, 0.0035))
    add(o, body(r, 350, 750, (0.003, 0.007)), 0.001, 0.3)
    add(o, grains(r, 0.012, r.i(1, 3), 3000, 8000, (0.0003, 0.001)), 0.006, 0.25)
    return o


@sound("combat.mandible_snap", takes=6)
def mandible_snap(r, k):
    # a soldier's or major's bite: a sharp click with a brittle crunch of cuticle giving way
    # (pass 2: deeper: the click's modes and the crunch an octave lower, the contact burst kept sharp, and the major's
    # head capsule thumping under it)
    o = zeros(0.09)
    add(o, hp(burst(r, 0.004, 0.00003, 0.0003), 1800), 0.001, 0.9)
    double_click(r, o, 0.001, 1200, 4800, (0.001, 0.005), sep=(0.002, 0.006), snap=0.8)
    add(o, body(r, 220, 520), 0.001, 0.6)
    add(o, crunch(r, r.u(0.022, 0.035), r.i(8, 14), 4800, 1800, 2.0, (0.0004, 0.002)), r.u(0.004, 0.008), 0.55)
    return o


@sound("combat.bite_crush", takes=5)
def bite_crush(r, k):
    # a crushing bite (fire ant majors, Atta majors, the Termant soldier's Macrotermes jaws): a click, then a dense
    # crunch of many tiny fractures, its resonance falling as the cuticle breaks down; the lowest and fullest bite
    # (pass 2: deeper: click and crunch an octave down, a heavy low-mid body, the late cracks down in the low mids)
    o = zeros(0.16)
    add(o, click(r, 900, 3400, 4, (0.0015, 0.006), 0.9), 0.001, 1.0)
    add(o, body(r, 160, 420, (0.006, 0.014), 3), 0.001, 0.7)
    add(o, crunch(r, r.u(0.06, 0.1), r.i(26, 40), 4000, 1000, 1.8, (0.0005, 0.003), 0.6), 0.003, 0.9)
    add(o, crunch(r, 0.03, r.i(5, 8), 1500, 600, 1.2, (0.001, 0.005)), r.u(0.01, 0.02), 0.5)
    return o


@sound("combat.scissor_cut", takes=5)
def scissor_cut(r, k):
    # a leafcutter's shear: the blades rasp past each other (a short, stridulation-like rasp: Atta stridulate while
    # they cut, the "vibratome") and close with a snip
    # (pass 2: deeper and no plink: the rasp's body a lot lower and quicker to die, the snip a dull, short closing
    # click with a body thump instead of a ringing high click)
    o = zeros(0.12)
    L = r.u(0.045, 0.07)
    rasp = stridulate(r, 1, 1600, 5500, (0.0002, 0.0008), (0.0, 0.0), (L, L), (1600, 2400), 0.3, body_n=2)
    add(o, norm(rasp), 0.002, 0.6)
    add(o, friction(r, L, 1800, 1800, 6000, (0.0002, 0.0008), 0.05), 0.002, 0.35)
    add(o, click(r, 1100, 3600, 3, (0.0005, 0.0018), 1.0), 0.002 + L, 1.0)
    add(o, body(r, 260, 600, (0.003, 0.008)), 0.002 + L, 0.5)
    return o


@sound("combat.chitin_crack", takes=6)
def chitin_crack(r, k):
    # a heavy hit: a brittle crunch of cuticle cracking
    # (pass 2: deeper: click and crunch an octave down, the struck body thumping under the crack)
    o = zeros(0.1)
    add(o, click(r, 1100, 4200, 4, (0.001, 0.0045), 1.0), 0.001, 1.0)
    add(o, body(r, 200, 500), 0.001, 0.55)
    add(o, crunch(r, r.u(0.035, 0.07), r.i(14, 24), 5000, 1400, 2.0, (0.0004, 0.0025)), 0.002, 0.8)
    return o


@sound("combat.termite_bite", takes=5)
def termite_bite(r, k):
    # soft-bodied termites: a duller, wetter crunch (thin, lightly sclerotised heads and soft prey)
    o = zeros(0.1)
    add(o, lp(click(r, 1500, 4800, 3, (0.0015, 0.006), 0.4), 7000), 0.001, 1.0)
    add(o, lp(crunch(r, r.u(0.03, 0.05), r.i(7, 11), 3800, 1200, 1.6, (0.0008, 0.004)), 8000), 0.003, 0.7)
    add(o, squelch(r, 0.04, 1800, 900, 5), 0.006, 0.35)
    add(o, bubbles(r, 0.03, r.i(2, 3), 1800, 4200, (0.002, 0.005)), 0.01, 0.25)
    return o


# ------------------------------------------------------------------ grips, holds, grapples


@sound("combat.grip", takes=5)
def grip(r, k):
    # taking hold (a grip at the start of a hold, a claw catching a creature's leg): legs scraping on chitin and the
    # held ant's squeak
    # (pass 2: dry and insect-like, not ghostly: the scrape is a zipper of claw catches with no breathy rub or slow
    # swell, and the held ant squeals, fast chirps rather than ringing squeaks)
    o = zeros(0.4)
    add(o, click(r, 1600, 6000, 3, (0.0008, 0.0035), 0.7), 0.001, 0.8)
    add(o, body(r, 280, 600, (0.003, 0.007)), 0.001, 0.35)
    add(o, zipper(r, r.u(0.14, 0.24)), 0.004, 0.55)
    if r.chance(0.85):
        add(o, squeal(r, r.i(1, 3)), r.u(0.03, 0.09), 0.5)
    return o


@sound("combat.grapple_scuffle", loop=True, lufs=-22)
def grapple_scuffle(r, k):
    # the scuffle bed (ants grappling in view): scrabbling legs, bodies rubbing, grips and squeaks, as one texture the
    # game plays in short grains
    # (pass 2: the ghostly wash is gone: the scrabbling is short zipper pulls of claw catches with no breathy rub or
    # slow swells, the squeaks are quick squeals, and the clicks ring low and briefly)
    dur = 8.0
    o = zeros(dur)
    t = 0.0
    while t < dur - 0.4:
        add(o, zipper(r, r.u(0.06, 0.22)), t, r.u(0.4, 1.0))
        t += r.u(0.05, 0.16)
    for _ in range(int(dur * 7)):
        add(o, click(r, 1600, 6000, 3, (0.0005, 0.0025), 0.6), r.u(0, dur - 0.05), r.u(0.2, 0.6))
    for _ in range(int(dur * 2.5)):
        add(o, squeal(r, r.i(1, 2)), r.u(0, dur - 0.3), r.u(0.15, 0.4))
    return o


# ------------------------------------------------------------------ stings, acid, glue


@sound("combat.sting", takes=5)
def sting(r, k):
    # a sting going in: a tiny wet tick as the lancets pierce, then a faint venom fizz
    o = zeros(0.18)
    add(o, click(r, 5000, 12000, 3, (0.0004, 0.0018), 0.8), 0.001, 1.0)
    add(o, bubbles(r, 0.012, r.i(2, 4), 2500, 6000, (0.0012, 0.003), (0.15, 0.3), 1.5), 0.002, 0.45)
    add(o, fizz(r, r.u(0.09, 0.14), 700, 5000, 13000, 0.25), 0.008, 0.22)
    return o


@sound("combat.sting_fire", takes=5)
def sting_fire(r, k):
    # fire ants: quicker and doubled (they grip with the mandibles and sting again and again)
    o = zeros(0.1)
    t2 = r.u(0.016, 0.03)
    for t, g in ((0.001, 1.0), (t2, r.u(0.6, 0.95))):
        add(o, click(r, 6000, 13000, 3, (0.0003, 0.0012), 0.8), t, g)
        add(o, bubbles(r, 0.008, r.i(1, 3), 3500, 7500, (0.0008, 0.002), (0.15, 0.3), 1.5), t + 0.001, 0.35 * g)
    add(o, fizz(r, 0.06, 900, 6000, 14000, 0.2), t2 + 0.004, 0.15)
    return o


@sound("combat.acid_spray", takes=5)
def acid_spray(r, k):
    # formic acid from the acidopore: a fine, fizzy hiss pulsing with the gaster's squeezes, with tiny droplet ticks
    dur = r.u(0.22, 0.36)
    n = int(dur * SR) + 1
    t = tlin(n)
    pulse = 0.65 + 0.35 * np.sin(2 * np.pi * r.u(18, 30) * t + r.u(0, 6)) ** 2
    e = np.minimum(1, t / 0.008) * np.exp(-t / (dur * 0.5)) * pulse
    o = zeros(dur + 0.05)
    add(o, norm(hiss(r, dur, 3500, 13000) * e), 0.0, 0.7)
    add(o, grains(r, dur, r.i(14, 24), 6000, 13000, (0.0002, 0.0008), 1.4, (0.15, 0.7)), 0.004, 0.5)
    add(o, fizz(r, dur, 1200, 5000, 13000, 0.1, dur * 0.6), 0.01, 0.3)
    return o


@sound("combat.acid_splat", takes=5)
def acid_splat(r, k):
    # acid landing on a body: a small wet tick and a fizz as it bites into the cuticle (no splash: the drops are tiny)
    o = zeros(0.45)
    add(o, click(r, 3500, 9000, 2, (0.0005, 0.002), 0.5), 0.001, 0.6)
    add(o, bubbles(r, 0.03, r.i(3, 6), 2500, 7000, (0.0015, 0.004), (0.1, 0.3), 1.6), 0.002, 0.6)
    add(o, fizz(r, r.u(0.3, 0.4), 1600, 4500, 13000, 0.3, 0.12), 0.006, 0.7)
    return o


@sound("combat.mortar_pop", takes=4)
def mortar_pop(r, k):
    # a mortar ant lobbing a droplet: a soft pop at launch (a drop leaving the acidopore) and a breath of spray
    o = zeros(0.14)
    add(o, bubble(r, r.u(900, 1400), r.u(0.003, 0.005), r.u(0.4, 0.8)), 0.001, 1.0)
    add(o, lp(burst(r, 0.01, 0.0005, 0.002), 3000), 0.0, 0.4)
    add(o, hiss(r, 0.08, 3000, 11000, [(0, 0), (0.005, 1), (0.08, 0)]), 0.002, 0.25)
    return o


@sound("combat.mortar_land", takes=4)
def mortar_land(r, k):
    # the droplet landing: a wet tick, a little splat and a fizz spreading (no explosion)
    o = zeros(0.55)
    add(o, squelch(r, 0.035, 2600, 1200, 6), 0.001, 0.6)
    add(o, bubbles(r, 0.05, r.i(4, 8), 1500, 6000, (0.002, 0.006), (0.1, 0.3), 1.5), 0.002, 0.7)
    add(o, fizz(r, 0.45, 1400, 4000, 13000, 0.3, 0.16), 0.01, 0.8)
    return o


@sound("species.glue_splat", takes=4)
def glue_splat(r, k):
    # a conehead's glue landing: a sticky, stringy sputter, threads stretching and snapping
    o = zeros(0.35)
    t = 0.001
    while t < 0.2:
        add(o, squelch(r, r.u(0.01, 0.025), r.u(1800, 3200), r.u(600, 1100), r.u(5, 9)), t, r.u(0.4, 1))
        t += r.u(0.012, 0.04)
    add(o, bubbles(r, 0.18, r.i(5, 9), 1200, 4000, (0.002, 0.006), (0.0, 0.15), 1.3), 0.004, 0.5)
    for _ in range(r.i(2, 4)):
        # a thread snapping: a tiny high tick
        add(o, click(r, 5000, 11000, 2, (0.0003, 0.001), 0.6), r.u(0.08, 0.28), r.u(0.15, 0.35))
    return o


@sound("species.nasute_glue", loop=True, lufs=-22, xf=0.4)
def nasute_glue(r, k):
    # a conehead soldier's glue stream: a sticky, wet sputter in bursts (the head's gland squeezing), fine threads
    dur = 3.0
    o = zeros(dur)
    t = 0.0
    while t < dur - 0.05:
        add(o, squelch(r, r.u(0.008, 0.02), r.u(2000, 4500), r.u(800, 1600), r.u(5, 10)), t, r.u(0.3, 1))
        t += r.u(0.01, 0.045)
    add(o, bubbles(r, dur - 0.05, int(dur * 40), 1500, 6000, (0.0015, 0.005), (0.0, 0.2), 1.0), 0, 0.4)
    add(o, norm(hiss(r, dur, 3000, 9000)) * 0.1, 0)
    return o


# ------------------------------------------------------------------ species


@sound("species.hellant_snap", takes=5)
def hellant_snap(r, k):
    # a hell ant's trap: the fastest, sharpest crack in the game (trap jaws close in a fraction of a millisecond):
    # an almost pure impulse ringing the head capsule very briefly
    o = zeros(0.04)
    add(o, hp(burst(r, 0.0015, 0.00001, 0.00012), 1500), 0.0008, 1.0)
    add(o, norm(body_ir(r, 4000, 14000, 5, (0.0005, 0.0025))), 0.0008, 0.75)
    # the jaws' own crack: a woody ring a few milliseconds long, so the snap reads as a hit and not a tick
    add(o, norm(body_ir(r, 1500, 3500, 3, (0.002, 0.006))), 0.0008, 0.6)
    return o


@sound("species.hellant_impale", takes=4)
def hellant_impale(r, k):
    # the impale and the finisher: a wet crunch as the horn and jaws go through
    o = zeros(0.25)
    add(o, click(r, 2200, 7000, 3, (0.001, 0.004), 0.8), 0.001, 0.8)
    add(o, crunch(r, r.u(0.05, 0.08), r.i(16, 26), 5500, 1500, 1.8, (0.0005, 0.003)), 0.002, 0.8)
    add(o, squelch(r, r.u(0.06, 0.1), 1700, 650, 5), 0.01, 0.55)
    add(o, bubbles(r, 0.08, r.i(4, 7), 1200, 3800, (0.002, 0.006), (0.1, 0.3), 1.4), 0.02, 0.4)
    return o


@sound("species.army_hook", takes=5)
def army_hook(r, k):
    # an army ant soldier's hooks: a rasp as the sickle-shaped mandibles drive in and seat, then the victim stridulates
    o = zeros(0.45)
    L = r.u(0.05, 0.08)
    add(o, norm(friction(r, L, 1800, 2200, 8000, (0.0003, 0.0015), 0.2)), 0.001, 0.6)
    add(o, click(r, 2000, 7000, 4, (0.001, 0.005), 0.9), L, 0.9)
    add(o, squeak(r, r.i(2, 3), 1.0, (650, 1050)), L + r.u(0.03, 0.07), 0.55)
    return o


@sound("species.sickle_snap", takes=4)
def sickle_snap(r, k):
    # a sickle-jaw soldier grabbing: long crossed blades snapping shut, the second blade a hair behind
    # (pass 2: the same deeper treatment as mandible_snap, which it is built like: blades' modes lower, the burst
    # kept sharp, a little head-capsule body under the close)
    o = zeros(0.055)
    add(o, hp(burst(r, 0.002, 0.00002, 0.0002), 1600), 0.001, 0.8)
    add(o, click(r, 1500, 5500, 4, (0.0006, 0.003), 0.9), 0.001, 1.0)
    add(o, click(r, 1300, 4500, 3, (0.0008, 0.0035), 0.7), 0.001 + r.u(0.002, 0.005), 0.6)
    add(o, body(r, 240, 560, (0.003, 0.008)), 0.001, 0.45)
    return o


@sound("species.sickle_acid", takes=4)
def sickle_acid(r, k):
    # the sickle-jaw's acid smeared on its victim: a wet smear and a fizz
    o = zeros(0.65)
    add(o, squelch(r, r.u(0.08, 0.14), 2400, 900, 4), 0.001, 0.5)
    add(o, fizz(r, r.u(0.45, 0.6), 1100, 4000, 12000, 0.35, 0.2), 0.01, 0.9)
    add(o, bubbles(r, 0.3, r.i(5, 9), 1600, 5500, (0.002, 0.005), (0.05, 0.25), 1.3), 0.02, 0.45)
    return o


@sound("species.termite_headbang", takes=4)
def termite_headbang(r, k):
    # termite soldiers' alarm: heads banging on the gallery wall in a burst, 11-19 beats a second, 5-22 beats a bout
    # (Hager & Kirchner 2013), energy at 1-5 kHz: dull, papery taps on carton and soil
    rate = r.u(11, 19)
    beats = r.i(6, 12)
    o = zeros(beats / rate + 0.06)
    wall = body_ir(r, 900, 4200, 5, (0.002, 0.009))
    for b in range(beats):
        t = b / rate * (1 + r.n(0.03))
        g = (0.6 + 0.4 * np.sin(np.pi * b / max(1, beats - 1))) * r.u(0.75, 1.0)
        exc = lp(burst(r, 0.004, 0.0003, 0.0012), 6000)
        add(o, norm(ring(exc, wall)), max(0, t) + 0.001, g)
        add(o, grains(r, 0.012, r.i(1, 3), 2500, 7000, (0.0004, 0.0015)), max(0, t) + 0.003, 0.15 * g)
    return o


@sound("species.termite_chew", takes=5, lufs=-24)
def termite_chew(r, k):
    # a worker chewing a fragment of wood loose while foraging: a quiet, fibrous crunch
    o = zeros(0.12)
    add(o, crunch(r, r.u(0.04, 0.07), r.i(6, 10), 5000, 2200, 1.3, (0.0006, 0.003)), 0.001, 0.8)
    add(o, norm(friction(r, 0.05, 900, 2500, 7000, (0.0004, 0.002), 0.2)), 0.008, 0.3)
    return o


@sound("species.saiyant_crackle", takes=3)
def saiyant_crackle(r, k):
    # a Saiy-Ant's gold crackle: a crisp crackle of dry cuticle and static
    o = zeros(0.35)
    add(o, crunch(r, r.u(0.18, 0.26), r.i(22, 34), 11000, 4500, 1.2, (0.0002, 0.0012), 0.8, 1.4), 0.001, 1.0)
    add(o, fizz(r, 0.25, 1500, 7000, 14000, 0.15, 0.1), 0.004, 0.25)
    return o


@sound("species.saiyant_surge", takes=3)
def saiyant_surge(r, k):
    # the golden surge: a rising rustle of rattled seeds and a stridulating shimmer climbing over it
    dur = r.u(2.0, 2.4)
    o = zeros(dur + 0.1)
    n = 260
    for _ in range(n):
        t = dur * r.u() ** 0.55
        add(o, click(r, 2500, 9000, 2, (0.0008, 0.004), 0.5), t, (t / dur) ** 1.3 * r.u(0.2, 1))
    sh = stridulate(r, 9, 5000, 12000, (0.0003, 0.0012), (0.02, 0.05), (0.12, 0.2), (900, 1400), 0.6)
    sh = norm(sh)[: len(o)]
    add(o, sh * np.linspace(0, 1, len(sh)) ** 2, 0.2, 0.35)
    return o


@sound("species.termant_absorb", takes=3)
def termant_absorb(r, k):
    # Termants absorb a corpse's genes: a soft organic gulp, a wet swallow
    o = zeros(0.8)
    add(o, squelch(r, 0.22, 1500, 380, 5), 0.01, 0.8)
    add(o, squelch(r, 0.18, 900, 300, 4), r.u(0.22, 0.3), 0.6)
    add(o, bubbles(r, 0.5, r.i(8, 14), 300, 1800, (0.004, 0.012), (0.1, 0.4), 1.2), 0.05, 0.6)
    return lp(o, 6000)


@sound("species.termant_caste", takes=3, lufs=-20)
def termant_caste(r, k):
    # a stolen caste raised: a rising chord of plucked tines (the one musical moment among the effects); the takes
    # differ in voicing and in how the tines are spread
    o = zeros(1.9)
    base = 392.0
    chord = [[0, 3, 7, 10, 14], [0, 5, 7, 10, 15], [0, 3, 7, 12, 14]][(k - 1) % 3]
    gap = r.u(0.11, 0.15)
    for i, semi in enumerate(chord):
        f = base * 2 ** (semi / 12)
        t0 = 0.02 + i * gap
        tine = modes(1.6, [f, f * 2.76, f * 5.4], [0.9, 0.25, 0.08], [1, 0.25, 0.08], [0, 0, 0])
        add(o, tine, t0, 0.8 - i * 0.05)
        add(o, lp(burst(r, 0.006, 0.0002, 0.001), 3000), t0, 0.15)
    return o


# ------------------------------------------------------------------ hits, flings, deaths


@sound("combat.fling", takes=4)
def fling(r, k):
    # an ant thrown by a big creature: a short scrabble as it loses hold, a moment in the air, a light tick landing
    o = zeros(0.4)
    L = r.u(0.06, 0.1)
    add(o, norm(friction(r, L, 1100, 2400, 9000, (0.0003, 0.0015), 0.25)), 0.001, 0.8)
    land = L + r.u(0.12, 0.2)
    add(o, click(r, 2500, 8000, 3, (0.0008, 0.004), 0.6), land, 0.7)
    add(o, grains(r, 0.05, r.i(3, 6), 2500, 8000, (0.0004, 0.002), 1.5), land + 0.002, 0.4)
    return o


def twitch(r, o, t0, dur, n, f_lo, f_hi, g):
    """The legs' last twitches: a short, sparse, fading run of tiny clicks."""
    for i in range(n):
        t = t0 + dur * r.u() ** 1.6
        add(o, click(r, f_lo, f_hi, 2, (0.0004, 0.002), 0.5), t, g * r.u(0.25, 1) * np.exp(-(t - t0) / dur))


@sound("combat.battle_bed", loop=True, lufs=-21)
def battle_bed(r, k):
    # a fight too big for single voices, heard as one texture: a dense insect brawl of clicks, crunches, scrapes,
    # stings and stridulation squeaks (never a crowd of people)
    # (pass 2: no plinks and nothing ghostly: the high ringing tick layer and the airy fizz are gone, the bites ring
    # lower and shorter, the scrapes are dry zipper pulls, and squeals join the stridulation)
    dur = 12.0
    o = zeros(dur)
    for _ in range(int(dur * 55)):
        o2 = zeros(0.03)
        double_click(r, o2, 0.0, r.u(1500, 2600), r.u(5000, 8000), (0.0006, 0.0025))
        add(o, o2, r.u(0, dur - 0.05), r.u(0.15, 0.9))
    for _ in range(int(dur * 9)):
        add(o, crunch(r, r.u(0.02, 0.06), r.i(6, 18), r.u(4000, 6500), r.u(1200, 2200), 2.0, (0.0004, 0.002)), r.u(0, dur - 0.1), r.u(0.2, 0.7))
    t = 0.0
    while t < dur - 0.4:
        add(o, zipper(r, r.u(0.06, 0.2)), t, r.u(0.15, 0.45))
        t += r.u(0.04, 0.12)
    for _ in range(int(dur * 1.5)):
        add(o, squeak(r, r.i(1, 3), 1.0, (800, 1300), (2200, 7000)), r.u(0, dur - 0.4), r.u(0.12, 0.3))
    for _ in range(int(dur * 2.0)):
        add(o, squeal(r, r.i(1, 3)), r.u(0, dur - 0.3), r.u(0.12, 0.35))
    return o
