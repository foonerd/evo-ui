EVO OPERATOR UI - RESPONSIVE FOLD MODEL

Status: agreed design, 2026-05-25. Implementation is phased - see
the end of this document. Thresholds are starting points, tuned
against the real panels.

SCOPE

The operator UI (evo-ui-shell) across every target panel, from
~2.8 inch (320x240) to 100 inch TVs, portrait and landscape,
including extreme-aspect bar displays (Waveshare 11.9 / 7.9 / 8.8).

WHY

The shipped layout keys off viewport width alone, with three
breakpoints. Width alone cannot decide whether to stack, and it
ignores orientation: a 1480x320 bar and a 320x1480 bar have nearly
the same pixel count and opposite needs. This model replaces the
three breakpoints with one coherent system. One architecture -
maintained once, verified once per panel - not two.

PRINCIPLES

1. Region priority. Four regions, in priority order:
   centre stage (now-playing)  >  nav  >  info  >  queue.
   As space runs out the lowest-priority region folds away first -
   into a drawer, a tab, or off-screen.

2. Two axes.
   - Width decides the column count: 3 / 2 / 1.
   - Height decides density and how the centre stage arranges
     itself: art ABOVE the controls when there is height, art
     BESIDE the controls when there is not.

3. A floor. Below a minimum there is nothing left to fold: only
   the now-playing shows; nav is one drawer; info and queue are
   off-screen.

4. A ceiling. Above a maximum the centre stage scales up as a
   unit - art, type and controls together - instead of stranding
   as a fixed island on a very large panel.

THE CENTRE STAGE

One comfortable width, shared by everything in it - art frame,
visualiser, progress bar, volume row - and the info card below
aligns to that same width. The progress bar is a seek control:
its width is the pixels-to-seconds exchange rate, so it has a
comfortable maximum and is never stretched past it. Spare width
on a large screen goes to the side regions, never into the bar.

  Centre width token (--evo-stage): a calm cap on normal screens,
  scaling up only past the large-format ceiling.
  Starting value: min(100%, 42rem). Tunable.

Internal arrangement:
  - tall - art above the controls (default when height allows).
  - wide - art beside the controls (short height).

TIERS

Solo    w < 480 and h < 480
        Only the now-playing. Nav is a drawer. Info and queue
        off-screen.

Strip   h < 430 and w < 1180
        One horizontal band - art, title, transport. No queue,
        no visualiser. (Landscape phone, small landscape panel.)

Bar     h < 430 and w >= 1180
        Wide but short. nav + now-playing + queue COLUMN. The
        now-playing is in its wide form (art beside controls);
        the spare width becomes the queue, not a stretched bar.
        (The 1480x320 landscape bar.)

Stack   w < 800 and h >= 430
        Single column: nav bar, now-playing, info, queue - all
        stacked, all visible. On the tall portrait bars height is
        abundant, so the queue is a full visible list, never a
        drawer. Centre stage tall or wide by height.

Split   800 <= w < 1180
        Two columns: slim nav rail + main. Queue and info fold
        below the now-playing.

Full    w >= 1180
        Three columns: nav, now-playing, queue. Info below the
        now-playing. Centre stage tall or wide by height.

Cinema  w >= 2400 (overlay on Full)
        The centre stage scales up as a unit.

7K      1180 <= w <= 1600, 680 <= h <= 820, landscape (overlay on Full)
        The 7-inch kiosk shape (native 1280x720 fullscreen, the
        canonical SBC-attached display). The base height-tier puts
        this in the row
        layout (art beside body), which is the right shape - but
        the desktop-windowed-row sizing makes the art too small
        and the rings off-target for a kiosk where every pixel
        of the 720 vertical is the canvas. 7K is an overlay on
        Full that expands the art back to ~min(380px, 50vh),
        restores the rings re-anchored against the larger art,
        lifts title typography one step, gives the visualiser a
        taller strip, and stretches the home-hero vertically so
        the centre stage sits at a comfortable optical centre
        instead of collapsing to its content height with dead
        space below. Same architecture as A's calm column,
        borrowing B's proportional fill on the vertical axis.

THE DENSITY KNOB

One user preference, riding on the single architecture as a
modifier - not a second layout. Comfortable vs Compact: it scales
the vertical rhythm and the art frame only, nothing structural.
Persisted like the theme. Both settings are valid; neither is a
degraded option. This is where user choice lives - the structural
calls are made by the viewport, not the user.

NOT DOING

Two parallel layout architectures offered as a user choice. They
would double the device-test matrix and the maintenance forever,
and one would rot. The viewport decides structure; the user
decides density only.

PHASES

P1  Centre stage: one capped width; visualiser, progress, volume
    and the info card all aligned to it. CSS only.
P2  Two-axis fold: width-driven column count + height-driven
    centre-stage arrangement (tall vs wide). Replaces the three
    width breakpoints.
P3  Strip / Bar split, and the tall-bar stacked queue.
P4  Cinema ceiling - centre stage scales as a unit.
P5  Density knob preference.
P6  7K - 7-inch kiosk tier (1280x720 fullscreen). Hero-art
    expanded back, rings restored, taller visualiser strip,
    home-hero stretches to fill 720 vertical. Sibling of P4.
    Includes the CSS-order fix: base .playback-hero-art rule
    moved BEFORE the row tier so cascade order does not collapse
    the placeholder to 0x0 inside the row tier's flex layout.

Each phase builds, deploys to the three rigs, and is verified
before the next begins.
