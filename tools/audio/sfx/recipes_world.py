"""Work, brood, orders and the world around the ants (spec §5): digging, building, food, brood, the order sounds, the
alerts, and the ambience (its one-shots and its looping beds). Same physics as the attacks: grains, small clicks,
friction, tiny bubbles; the naturally tonal calls (birds, crickets, frogs, an owl) are the only pitched voices.
"""
import numpy as np

from dsp import (SR, add, body_ir, brown, bubble, bubbles, burst, click, creak, crunch, env_ad, env_points, fizz, friction,
                 grains, hiss, hp, impulses, lp, modes, norm, onepole_lp, peak, pink, ring, seamless, squelch, stridulate, swish,
                 thud, tlin, tone, train, zeros, bp, svf_bp)
from recipes_combat import double_click, squeak
from recipes_creatures import hollow
from registry import sound

# ------------------------------------------------------------------ digging, building, food


@sound("ant.dig_bite", takes=6)
def dig_bite(r, k):
    # soil bitten off a tunnel face: the mandibles' click, a small crunch of packed grains, a dull crumble
    o = zeros(0.15)
    add(o, click(r, 2500, 8000, 3, (0.0008, 0.003), 0.5), 0.001, 0.5)
    add(o, crunch(r, r.u(0.05, 0.08), r.i(10, 16), 5500, 1500, 1.6, (0.0006, 0.003)), 0.002, 1.0)
    n = int(0.08 * SR)
    add(o, lp(r.noise(n) * env_ad(n, 0.004, 0.02), 900), 0.004, 0.25)
    return o


@sound("ant.soil_grains", takes=5, lufs=-23)
def soil_grains(r, k):
    # grains trickling down and bouncing after a bite
    dur = r.u(0.35, 0.6)
    o = zeros(dur + 0.05)
    add(o, grains(r, dur, r.i(25, 45), 1800, 8000, (0.0004, 0.002), 1.6, (0.1, 1.0)), 0.001, 1.0)
    return o


@sound("ant.pellet_drop", takes=5)
def pellet_drop(r, k):
    # a soil pellet set down at the spoil heap: a soft thud and a little scatter
    o = zeros(0.16)
    add(o, thud(r, r.u(280, 420), r.u(0.008, 0.014)), 0.001, 0.8)
    add(o, grains(r, 0.06, r.i(4, 8), 2000, 7000, (0.0004, 0.002), 1.5), 0.004, 0.6)
    return o


@sound("ant.drag_small", takes=5, lufs=-23)
def drag_small(r, k):
    # a small food item dragged a little way: a light scrape with a bump or two
    dur = r.u(0.25, 0.4)
    o = zeros(dur + 0.03)
    add(o, norm(friction(r, dur, r.u(180, 300), 1600, 7000, (0.0004, 0.002), 0.35)), 0.005, 1.0)
    for _ in range(r.i(1, 3)):
        add(o, click(r, 1800, 6000, 2, (0.001, 0.004), 0.4), r.u(0.03, dur), 0.5)
    return o


@sound("ant.drag_heavy", takes=5, lufs=-22)
def drag_heavy(r, k):
    # a large item hauled by a team: a heavier, lower scrape with bumps
    dur = r.u(0.45, 0.7)
    o = zeros(dur + 0.03)
    add(o, norm(friction(r, dur, r.u(250, 400), 800, 4500, (0.0008, 0.004), 0.4)), 0.005, 1.0)
    for _ in range(r.i(2, 4)):
        add(o, thud(r, r.u(300, 500), 0.008), r.u(0.03, dur), 0.35)
    return o


@sound("ant.pick_up", takes=5, lufs=-23)
def pick_up(r, k):
    # picking up a load: the mandibles closing on it (a soft click) and a brief scrape as it lifts
    o = zeros(0.12)
    add(o, click(r, 2200, 7000, 3, (0.0008, 0.004), 0.4), 0.001, 0.8)
    add(o, norm(friction(r, r.u(0.04, 0.07), 400, 2000, 7000, (0.0004, 0.002), 0.3)), 0.008, 0.45)
    return o


@sound("ant.put_down", takes=5, lufs=-23)
def put_down(r, k):
    # setting a load down: a soft tap and a grain or two
    o = zeros(0.12)
    add(o, thud(r, r.u(350, 600), 0.007), 0.001, 0.7)
    add(o, click(r, 2000, 6000, 2, (0.001, 0.004), 0.3), 0.002, 0.4)
    add(o, grains(r, 0.04, r.i(2, 4), 2500, 7000, (0.0004, 0.0015)), 0.006, 0.3)
    return o


@sound("ant.food_cut", takes=5)
def food_cut(r, k):
    # mandibles shearing soft food (an insect, fruit): a fibrous crunch with moisture
    o = zeros(0.18)
    add(o, crunch(r, r.u(0.05, 0.09), r.i(10, 16), 4500, 1500, 1.5, (0.0006, 0.003)), 0.001, 0.9)
    add(o, norm(friction(r, 0.06, 1200, 2000, 7000, (0.0003, 0.0015), 0.3)), 0.01, 0.35)
    add(o, bubbles(r, 0.06, r.i(2, 4), 1500, 4000, (0.0015, 0.004)), 0.02, 0.3)
    return o


@sound("ant.seed_crack", takes=6)
def seed_crack(r, k):
    # a seed's coat cracking in a major's jaws: a sharp crack and fragments bouncing
    o = zeros(0.18)
    add(o, hollow(r, 1500, 6000, (0.002, 0.008), 4), 0.001, 1.0)
    add(o, crunch(r, 0.04, r.i(8, 12), 7000, 2500, 2.0), 0.002, 0.5)
    add(o, grains(r, 0.12, r.i(4, 8), 2500, 8000, (0.0006, 0.003), 1.3), 0.03, 0.4)
    return o


@sound("ant.leaf_cut", takes=5)
def leaf_cut(r, k):
    # a leafcutter scissoring a disc: rapid snips and crinkle, with the faint buzz of its stridulation stiffening the
    # leaf (the "vibratome": Tautz, Roces & Hölldobler 1995)
    dur = r.u(0.32, 0.45)
    o = zeros(dur + 0.05)
    t = 0.004
    while t < dur - 0.03:
        add(o, click(r, 2500, 9000, 3, (0.0006, 0.003), 0.8), t, r.u(0.6, 1))
        add(o, grains(r, 0.03, r.i(4, 8), 3000, 10000, (0.0003, 0.0012)), t + 0.004, 0.35)
        t += r.u(0.05, 0.09)
    vib = stridulate(r, 3, 4000, 11000, (0.0003, 0.001), (0.01, 0.03), (0.08, 0.12), (900, 1300), 0.2)
    add(o, norm(vib), 0.01, 0.2)
    return o


@sound("ant.stridulate", takes=5, lufs=-22)
def ant_stridulate(r, k):
    # alarm stridulation: faint, fine rasping chirps (the scraper on the postpetiole drawn over the gaster's file)
    o = zeros(0.4)
    add(o, norm(stridulate(r, r.i(3, 5), 3000, 10000, (0.0003, 0.0015), (0.015, 0.04), (0.03, 0.06), (700, 1300), 0.25)), 0.002, 1.0)
    return o


@sound("ant.antenna_tap", takes=4, lufs=-28)
def antenna_tap(r, k):
    # antennae tapping a nestmate (only heard right up close): the faintest double tap
    o = zeros(0.08)
    add(o, click(r, 5000, 12000, 2, (0.0002, 0.0008), 0.3), 0.001, 1.0)
    add(o, click(r, 5000, 12000, 2, (0.0002, 0.0008), 0.3), r.u(0.03, 0.05), r.u(0.5, 0.9))
    return o


# ------------------------------------------------------------------ brood


@sound("ant.egg_set", takes=4, lufs=-24)
def egg_set(r, k):
    # an egg set down on the brood pile: soft and slightly wet
    o = zeros(0.12)
    add(o, squelch(r, 0.04, 2400, 1400, 6), 0.001, 0.8)
    add(o, bubbles(r, 0.02, r.i(1, 2), 2500, 4500, (0.0015, 0.003)), 0.004, 0.5)
    return o


@sound("ant.larva_hatch", takes=4, lufs=-22)
def larva_hatch(r, k):
    # a new adult breaking out of its cocoon: a soft, wet, fibrous tear
    o = zeros(0.5)
    add(o, norm(friction(r, r.u(0.18, 0.28), 1500, 2500, 9000, (0.0002, 0.001), 0.3)), 0.005, 0.7)
    add(o, squelch(r, 0.1, 1800, 700, 5), 0.12, 0.5)
    add(o, bubbles(r, 0.2, r.i(3, 6), 1500, 4500, (0.0015, 0.005)), 0.1, 0.35)
    return o


@sound("ant.queen_lay", takes=3, lufs=-23)
def queen_lay(r, k):
    # the queen laying an egg: a soft, wet sound
    o = zeros(0.3)
    add(o, squelch(r, 0.12, 1500, 800, 5), 0.005, 0.8)
    add(o, bubbles(r, 0.12, r.i(2, 4), 1200, 3500, (0.002, 0.006)), 0.03, 0.4)
    return o


# ------------------------------------------------------------------ orders


@sound("ui.marker", takes=3, lufs=-19)
def ui_marker(r, k):
    # placing a pheromone marker: a soft, natural chirp (a cricket's syllable: three pure pulses); the game plays the
    # five markers at five pentatonic pitches, so the carrier stays clean and steady
    o = zeros(0.11)
    f = 2900 * r.u(0.99, 1.01)
    for i in range(3):
        n = int(0.016 * SR)
        e = np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5
        add(o, tone(f * (1 + 0.004 * i), 0.016, None, (1, 0.04)) [:n] * e, 0.002 + i * 0.028, 1 - 0.1 * i)
    return o


@sound("ui.marker_lift", takes=3, lufs=-22)
def ui_marker_lift(r, k):
    # lifting a marker: a light click
    o = zeros(0.05)
    add(o, hollow(r, 2500, 7000, (0.002, 0.006), 3), 0.001, 1.0)
    return o


@sound("ui.group_assign", takes=3, lufs=-22)
def ui_group_assign(r, k):
    # moving a group card: a fingertip on a dry leaf
    o = zeros(0.08)
    add(o, grains(r, 0.04, r.i(10, 16), 2500, 9000, (0.0003, 0.0012), 1.2), 0.001, 1.0)
    return o


@sound("ui.tool_dig", takes=4, lufs=-21)
def ui_tool_dig(r, k):
    # marking soil to dig: a soft soil tap
    o = zeros(0.1)
    add(o, thud(r, r.u(300, 450), 0.01), 0.001, 0.8)
    add(o, grains(r, 0.05, r.i(4, 7), 2000, 7000, (0.0004, 0.0018), 1.4), 0.004, 0.5)
    return o


@sound("ui.tool_build", takes=4, lufs=-21)
def ui_tool_build(r, k):
    # placing a tile: an earthy tap and a puff of soil
    o = zeros(0.2)
    add(o, thud(r, r.u(220, 320), 0.014), 0.001, 0.9)
    n = int(0.12 * SR)
    add(o, lp(r.noise(n) * env_ad(n, 0.01, 0.035), 2200), 0.01, 0.35)
    add(o, grains(r, 0.1, r.i(5, 9), 2000, 7000, (0.0004, 0.0018), 1.5), 0.01, 0.35)
    return o


@sound("ui.tool_upgrade", takes=3, lufs=-21)
def ui_tool_upgrade(r, k):
    # marking an upgrade: two earthy taps and a little trickle
    o = zeros(0.3)
    add(o, thud(r, 320, 0.01), 0.001, 0.8)
    add(o, thud(r, 400, 0.009), r.u(0.08, 0.1), 0.7)
    add(o, grains(r, 0.15, r.i(8, 12), 2200, 8000, (0.0004, 0.0016), 1.2), 0.12, 0.4)
    return o


@sound("ui.tool_delete", takes=3, lufs=-21)
def ui_tool_delete(r, k):
    # marking a tile for removal: a clod crumbling
    o = zeros(0.45)
    add(o, crunch(r, 0.1, r.i(14, 22), 3500, 900, 1.6, (0.0008, 0.004)), 0.001, 1.0)
    add(o, grains(r, 0.3, r.i(18, 28), 1800, 7000, (0.0004, 0.002), 1.5), 0.04, 0.6)
    return o


@sound("ui.menu_tap", takes=4, lufs=-23)
def ui_menu_tap(r, k):
    # menu buttons: a quiet tap on dry wood
    o = zeros(0.05)
    add(o, hollow(r, 1200, 4000, (0.003, 0.012), 4), 0.001, 1.0)
    return o


def drum(r, o, t, beats, rate, f_lo, f_hi, g=1.0, dec=(0.003, 0.012)):
    """Heads drumming on the nest wall (the colony's alarm): dull taps at `rate` a second."""
    wall = body_ir(r, f_lo, f_hi, 5, dec)
    for b in range(beats):
        add(o, norm(ring(lp(burst(r, 0.005, 0.0003, 0.0015), 5000), wall)), t + b / rate * (1 + r.n(0.02)), g * r.u(0.8, 1))


@sound("ui.alert_queen", takes=3, lufs=-17)
def ui_alert_queen(r, k):
    # the queen under attack: the colony's alarm drumming, fast and hard, under bright alarm stridulation; it must cut
    # through a battle, so its body sits at 0.5-3 kHz where the fight is thin
    o = zeros(0.9)
    drum(r, o, 0.002, 10, 13, 450, 2600, 1.0, (0.004, 0.016))
    add(o, norm(stridulate(r, 4, 1800, 6000, (0.0006, 0.0025), (0.02, 0.04), (0.07, 0.11), (500, 800), 0.25)), 0.01, 0.55)
    return o


@sound("ui.alert_starving", takes=3, lufs=-19)
def ui_alert_starving(r, k):
    # the colony is starving: a slow, dull drumming
    o = zeros(0.9)
    drum(r, o, 0.002, 3, 3.8, 250, 1300, 1.0, (0.006, 0.025))
    return o


@sound("ui.alert_invasion", takes=3, lufs=-17)
def ui_alert_invasion(r, k):
    # intruders in the nest: urgent drumming in two bursts and stridulation
    o = zeros(1.0)
    drum(r, o, 0.002, 7, 17, 500, 3000, 1.0)
    drum(r, o, 0.5, 7, 17, 500, 3000, 0.9)
    add(o, norm(stridulate(r, 5, 2000, 7000, (0.0005, 0.002), (0.02, 0.05), (0.06, 0.1), (600, 1000), 0.3)), 0.02, 0.45)
    return o


@sound("ui.message_good", takes=3, lufs=-20)
def ui_message_good(r, k):
    # good news: a dry seed pod shaken twice
    o = zeros(0.45)
    pod = body_ir(r, 1500, 5000, 4, (0.003, 0.012))
    for t0 in (0.002, r.u(0.17, 0.21)):
        for _ in range(r.i(18, 28)):
            add(o, click(r, 2500, 8000, 2, (0.0005, 0.002), 0.5), t0 + 0.07 * r.u() ** 1.3, r.u(0.2, 0.8))
        add(o, norm(ring(lp(burst(r, 0.004, 0.0003, 0.001), 4000), pod)), t0, 0.5)
    return o


@sound("ui.message_warn", takes=3, lufs=-20)
def ui_message_warn(r, k):
    # a warning: two dull knocks on wood
    o = zeros(0.4)
    add(o, hollow(r, 300, 1300, (0.012, 0.04), 5), 0.002, 1.0)
    add(o, hollow(r, 280, 1200, (0.012, 0.04), 5), r.u(0.16, 0.2), 0.85)
    return o


# ------------------------------------------------------------------ ambience: one-shots


@sound("amb.bird", takes=6, lufs=-24)
def amb_bird(r, k):
    # a distant songbird phrase (different birds and calls): whistled notes and trills, softened by distance
    kind = k % 3
    dur = r.u(0.8, 2.2)
    o = zeros(dur + 0.3)
    t = 0.02
    while t < dur:
        if kind == 0:  # a run of falling whistles
            L = r.u(0.06, 0.14)
            f0 = r.u(3200, 5200)
            n = int(L * SR)
            f = np.linspace(f0, f0 * r.u(0.6, 0.85), n)
            add(o, tone(f, L, None, (1, 0.08))[:n] * np.sin(np.pi * np.linspace(0, 1, n)) ** 1.2, t, r.u(0.6, 1))
            t += L + r.u(0.03, 0.09)
        elif kind == 1:  # a trill
            L = r.u(0.3, 0.6)
            n = int(L * SR)
            fm = r.u(18, 28)
            f = r.u(3800, 5500) + r.u(500, 1200) * np.sin(2 * np.pi * fm * tlin(n))
            e = np.sin(np.pi * np.linspace(0, 1, n)) ** 0.8 * (0.5 + 0.5 * np.sin(2 * np.pi * fm * tlin(n)) ** 2)
            add(o, tone(f, L, None, (1, 0.05))[:n] * e, t, 1)
            t += L + r.u(0.15, 0.4)
        else:  # two-note calls, up-down
            for f0, f1 in ((r.u(2600, 3400), r.u(3800, 4600)), (r.u(3800, 4600), r.u(2400, 3200))):
                L = r.u(0.08, 0.16)
                n = int(L * SR)
                add(o, tone(np.geomspace(f0, f1, n), L, None, (1, 0.1))[:n] * np.sin(np.pi * np.linspace(0, 1, n)), t, 1)
                t += L + r.u(0.02, 0.05)
            t += r.u(0.2, 0.5)
    return lp(o, 7000)


@sound("amb.cricket", takes=5, lufs=-24)
def amb_cricket(r, k):
    # one field cricket chirp: three or four pure pulses near 4.5 kHz (the wing's harp resonating)
    o = zeros(0.2)
    f = r.u(4300, 4900)
    for i in range(r.i(3, 4)):
        n = int(0.017 * SR)
        e = np.sin(np.pi * np.linspace(0, 1, n)) ** 1.2
        add(o, tone(f * (1 - 0.01 * i), 0.017, None, (1, 0.05, 0.02))[:n] * e, 0.003 + i * 0.033, 1)
    return o


@sound("amb.katydid", takes=4, lufs=-25)
def amb_katydid(r, k):
    # a katydid's rasp at night ("ka-ty-did"): two or three syllables of a dry, high tooth train
    o = zeros(0.75)
    t = 0.01
    for s in range(r.i(2, 3)):
        L = r.u(0.06, 0.12)
        add(o, norm(stridulate(r, 1, 7000, 15000, (0.0002, 0.0008), (0.0, 0.0), (L, L), (2200, 3200), 0.1)), t, 1)
        t += L + r.u(0.08, 0.14)
    return o


@sound("amb.fly_pass", takes=4, lufs=-24)
def amb_fly_pass(r, k):
    # a fly or small bee buzzing past (wingbeats near 150-250 Hz and their harmonics), swelling and bending in pitch
    dur = r.u(1.6, 2.6)
    n = int(dur * SR)
    t = tlin(n)
    f0 = r.u(150, 240)
    c = dur * r.u(0.4, 0.6)
    dop = 1 + 0.06 * np.tanh((c - t) * 3)
    f = f0 * dop * (1 + 0.02 * np.sin(2 * np.pi * r.u(3, 6) * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    buzz = sum((1 / h ** 0.9) * np.sin(h * ph + r.u(0, 6)) for h in range(1, 14))
    e = 1 / (1 + ((t - c) / (dur * 0.18)) ** 2)
    o = bp(buzz * e, 120, 6000)
    return onepole_lp(o, 1500 + 6000 * e)


@sound("amb.frog", takes=5, lufs=-24)
def amb_frog(r, k):
    # frogs croaking in the distance at night: a pulsed croak (glottal pulses ringing the vocal sac)
    dur = r.u(0.4, 1.0)
    o = zeros(dur + 0.2)
    rate = r.u(55, 90)
    ir = modes(0.05, [r.u(500, 700), r.u(1100, 1500), r.u(2000, 2600)], [0.006, 0.004, 0.003], [1, 0.6, 0.3])
    t = 0.01
    while t < dur:
        L = r.u(0.12, 0.25)
        ts = train(r, L, rate, rate * 0.9, 0.04, start=t)
        e = [np.sin(np.pi * (x - t) / L) for x in ts]
        exc = impulses(r, dur + 0.1, ts, e)
        add(o, ring(exc, ir)[: len(o)], 0, 1)
        t += L + r.u(0.08, 0.3)
    return lp(o, 3500)


@sound("amb.owl", takes=3, lufs=-24)
def amb_owl(r, k):
    # a tawny owl far away: a long hoot, a pause, a wavering run of hoots
    o = zeros(2.4)
    f = r.u(700, 820)
    def hoot(L, f0, f1, vib=0.0):
        n = int(L * SR)
        e = np.sin(np.pi * np.linspace(0, 1, n) ** 0.7) ** 1.3
        return tone(np.linspace(f0, f1, n), L, None, (1, 0.12, 0.04), vib, 9)[:n] * e
    add(o, hoot(0.45, f, f * 0.97), 0.02, 1)
    t = 0.02 + 0.45 + r.u(0.6, 0.9)
    add(o, hoot(0.12, f * 0.92, f), t, 0.6)
    add(o, hoot(r.u(0.6, 0.8), f * 1.02, f * 0.95, 0.03), t + 0.25, 0.8)
    return lp(o, 2500)


@sound("amb.drip", takes=5, lufs=-23)
def amb_drip(r, k):
    # a single water drop falling into a puddle: an impact tick and a bright bubble rising in pitch
    o = zeros(0.4)
    add(o, click(r, 2000, 6000, 2, (0.0005, 0.002), 0.4), 0.001, 0.3)
    add(o, bubble(r, r.u(900, 1700), r.u(0.012, 0.025), r.u(0.6, 1.2)), 0.002, 1.0)
    add(o, bubbles(r, 0.1, r.i(1, 3), 1500, 3500, (0.004, 0.01)), 0.03, 0.3)
    return o


@sound("amb.raindrop_big", takes=5, lufs=-21)
def amb_raindrop_big(r, k):
    # one huge raindrop landing beside an ant: a thump into the soil, a splash of droplets and a bubble
    o = zeros(0.55)
    add(o, thud(r, r.u(160, 260), 0.02), 0.001, 0.9)
    add(o, hiss(r, 0.08, 1500, 9000, [(0, 0), (0.004, 1), (0.08, 0)]), 0.002, 0.45)
    add(o, grains(r, 0.25, r.i(10, 18), 2500, 9000, (0.0005, 0.002), 1.3), 0.03, 0.4)
    add(o, bubble(r, r.u(600, 1000), 0.02, 0.5), 0.01, 0.3)
    return o


@sound("amb.thunder", takes=3, lufs=-22)
def amb_thunder(r, k):
    # distant thunder rolling: a crackle at the start, then a long low roll swelling and fading
    dur = r.u(4.5, 7.0)
    n = int(dur * SR)
    t = tlin(n)
    e = np.zeros(n)
    for _ in range(r.i(3, 6)):
        c = r.u(0.2, dur * 0.6)
        w = r.u(0.3, 1.2)
        e += r.u(0.4, 1) * np.exp(-((t - c) / w) ** 2)
    e = e / e.max() * np.minimum(1, t / 0.05) * np.exp(-t / (dur * 0.5))
    o = norm(lp(brown(r, n), 180, 3)) * e
    o += 0.3 * norm(lp(r.noise(n), 900)) * e ** 2
    return o


@sound("amb.soil_trickle", takes=5, lufs=-25)
def amb_soil_trickle(r, k):
    # soil grains trickling down a tunnel wall
    dur = r.u(0.5, 1.3)
    o = zeros(dur + 0.05)
    add(o, grains(r, dur, r.i(30, 70), 1500, 6500, (0.0005, 0.0025), 1.2, (0.05, 0.8)), 0.001, 1.0)
    return lp(o, 7000)


@sound("amb.root_creak", takes=4, lufs=-25)
def amb_root_creak(r, k):
    # a root creaking in the soil as it shifts
    dur = r.u(0.5, 1.3)
    o = zeros(dur + 0.1)
    add(o, norm(creak(r, dur, r.u(20, 40), r.u(45, 90), 200, 1400, (0.006, 0.03), [(0, 0), (dur * 0.3, 1), (dur, 0.2)])), 0, 1)
    return lp(o, 3500)


# ------------------------------------------------------------------ ambience: beds (stereo loops)


def gusts(r, n, k=4, base=0.35):
    t = tlin(n)
    g = np.full(n, base)
    dur = n / SR
    for _ in range(int(dur / k) + 2):
        c = r.u(0, dur)
        w = r.u(0.8, 2.5)
        g += r.u(0.3, 0.8) * np.exp(-((t - c) / w) ** 2)
    return g / g.max()


def leafy(r, dur, rate, f_lo, f_hi, gain_curve=None):
    """Dry leaf litter crackling: grains in clusters (a leaf edge flexing), denser when the gust curve is high."""
    n = int(dur * SR) + 1
    o = np.zeros(n)
    g = gain_curve if gain_curve is not None else np.ones(n)
    t = 0.0
    while t < dur - 0.05:
        i = min(n - 1, int(t * SR))
        if r.u() < g[i]:
            add(o, grains(r, r.u(0.01, 0.05), r.i(2, 8), f_lo, f_hi, (0.0003, 0.0015), 1.0, (0.2, 1)), t, g[i] * r.u(0.3, 1))
        t += -np.log(max(1e-6, r.u())) / rate
    return o


def stereo(fn, r, *a):
    return np.stack([fn(r, *a), fn(r, *a)])


@sound("amb.wind_grass", loop=True, stereo=True, lufs=-26, xf=3.0)
def amb_wind_grass(r, k):
    # wind through grass and leaves, heard from the ground: soft gusts, blades swishing, a leaf ticking now and then
    dur = 32.0
    n = int(dur * SR)
    def ch(r):
        g = gusts(r, n, 5)
        w = norm(lp(pink(r, n), 700)) * (0.3 + 0.7 * g)
        sw = norm(bp(r.noise(n), 1200, 5000)) * g ** 2 * 0.25
        lf = norm(leafy(r, dur, 6, 2500, 9000, g)[:n]) * 0.2
        return w + sw + lf
    return np.stack([ch(r), ch(r)])


@sound("amb.leaves_rustle", loop=True, stereo=True, lufs=-26, xf=2.0)
def amb_leaves_rustle(r, k):
    # dry leaf litter up close (the macro layer when zoomed in): crisp crackles flaring and settling
    dur = 24.0
    n = int(dur * SR)
    def ch(r):
        g = gusts(r, n, 3, 0.25)
        lf = norm(leafy(r, dur, 26, 2200, 10000, g)[:n])
        bed = norm(bp(r.noise(n), 2000, 8000)) * g * 0.08
        return lf + bed
    return np.stack([ch(r), ch(r)])


@sound("amb.cicada", loop=True, stereo=True, lufs=-28, xf=3.0)
def amb_cicada(r, k):
    # cicadas in warm daylight: tymbal clicks resonating near 5-6 kHz, swelling and fading, from a little way off
    dur = 28.0
    n = int(dur * SR)
    def ch(r):
        t = tlin(n)
        rate = r.u(180, 260)
        exc = (r.g.uniform(size=n) < rate / SR).astype(float)
        ir = modes(0.01, [r.u(5000, 6200), r.u(7000, 9000)], [0.0015, 0.0008], [1, 0.4])
        x = norm(ring(exc, ir)[:n])
        sw = np.zeros(n)
        tt = 0.0
        while tt < dur:
            L = r.u(4, 9)
            sw += np.exp(-((t - tt - L / 2) / (L / 2.5)) ** 2) * r.u(0.4, 1)
            tt += L * r.u(0.6, 1.1)
        return lp(x * (0.15 + sw / max(1e-9, sw.max())), 9000)
    return np.stack([ch(r), ch(r)])


@sound("amb.water_stream", loop=True, stereo=True, lufs=-25, xf=2.0)
def amb_water_stream(r, k):
    # a small stream trickling: many small bubbles and a soft wash
    dur = 24.0
    n = int(dur * SR)
    def ch(r):
        b = bubbles(r, dur, int(dur * 70), 300, 2500, (0.003, 0.012), (0.1, 0.5), 1.0)[:n]
        wash = norm(bp(pink(r, n), 200, 3000)) * 0.35
        return norm(b) + wash
    return np.stack([ch(r), ch(r)])


@sound("amb.sand_hiss", loop=True, stereo=True, lufs=-27, xf=3.0)
def amb_sand_hiss(r, k):
    # wind blowing fine sand across the ground: a bright, fine hiss of grains in gusts
    dur = 24.0
    n = int(dur * SR)
    def ch(r):
        g = gusts(r, n, 4)
        h = norm(bp(r.noise(n), 3500, 12000)) * g ** 1.5 * 0.5
        gr = norm(leafy(r, dur, 60, 5000, 13000, g)[:n]) * 0.6
        w = norm(lp(pink(r, n), 500)) * (0.2 + 0.5 * g)
        return h + gr + w
    return np.stack([ch(r), ch(r)])


@sound("amb.rain", loop=True, stereo=True, lufs=-24, xf=2.0)
def amb_rain(r, k):
    # rain heard by an ant: drops thudding into soil and slapping leaves all around, a fine wash under them
    dur = 20.0
    n = int(dur * SR)
    def ch(r):
        o = np.zeros(n)
        for _ in range(int(dur * 25)):
            t = r.u(0, dur - 0.1)
            if r.u() < 0.5:
                add(o, thud(r, r.u(200, 500), r.u(0.004, 0.01)), t, r.u(0.1, 0.6))
            else:
                add(o, click(r, 1500, 6000, 3, (0.001, 0.005), 0.6), t, r.u(0.1, 0.5))
        wash = norm(bp(pink(r, n), 400, 8000)) * 0.4
        return norm(o) + wash
    return np.stack([ch(r), ch(r)])


@sound("amb.nest_room", loop=True, stereo=True, lufs=-30, xf=3.0)
def amb_nest_room(r, k):
    # inside the nest: a close, muffled, earthy room tone with the odd grain settling
    dur = 24.0
    n = int(dur * SR)
    def ch(r):
        tone_ = norm(lp(brown(r, n), 260, 2)) * 0.8
        g = norm(grains(r, dur, int(dur * 3), 1200, 4000, (0.0008, 0.003), 1.0, (0.05, 0.3))[:n]) * 0.08
        return tone_ + g
    return np.stack([ch(r), ch(r)])


@sound("amb.colony_rumble", loop=True, stereo=True, lufs=-29, xf=3.0)
def amb_colony_rumble(r, k):
    # the colony at work, felt through the soil: a low rumble with a faint, distant scratching of many jaws
    dur = 24.0
    n = int(dur * SR)
    def ch(r):
        t = tlin(n)
        sw = 0.7 + 0.3 * np.sin(2 * np.pi * t / 6.1 + r.u(0, 6))
        rum = norm(lp(brown(r, n), 140, 3)) * sw
        sc = norm(lp(grains(r, dur, int(dur * 120), 1500, 5000, (0.0005, 0.002), 1.0, (0.05, 0.5))[:n], 2500)) * 0.25
        return rum + sc
    return np.stack([ch(r), ch(r)])
