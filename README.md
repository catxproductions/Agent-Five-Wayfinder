# Agent-Five-Wayfinder

**Version:** 1.0.0  
**Status:** Initial runnable prototype  
**Language:** Nexius  
**Model topology:** `11-15-15-14-14-10-10-8-4`

Agent-Five-Wayfinder is a separate Nexius-native autonomous navigation experiment. It does not modify Agent-Five-Nexus.

## Run it

Open the repository through GitHub Pages, or serve the repository root with a local static HTTP server. The page loads the Nexius compiler and neural module from `vendor/nexius/`, then compiles and runs `Wayfinder.nexius` when **Start agent** is selected.

Opening `index.html` directly as a `file://` URL may block loading the Nexius source file. Use GitHub Pages or a local HTTP server instead.

## Agent identity and movement

Agent Five is represented by its canonical **solid red circle**. Wayfinder preserves continuous two-axis movement: the first two neural outputs control X/Y thrust, and the third controls braking. The fourth output controls the strength of the environment's obstacle-avoidance assistance.

## Network

- Input: 11 normalized environment observations, including absolute normalized goal coordinates and the binary `isContactingSomething` contact flag.
- Hidden layers: 15, 15, 14, 14, 10, 10, 8.
- Output: 4 continuous controls.
- Total neurons: 101.
- Weights: 1,148.
- Biases: 90.
- Trainable parameters: 1,238.

## Generational training

Enable **Generational training** before starting the agent to run an evolutionary population instead of the single-agent view. Every candidate has its own position, velocity, energy, goal progress, neural-weight checkpoint, goal location, and independently randomized obstacle layout.

- Population size: 15–300 agents (default 15).
- First candidate to collect 5 goals becomes the generation successor.
- The successor's neural weights are retained unchanged as the next generation's elite.
- Every other candidate is initialized as a mutated copy of the successor's weights.
- The elite and all descendants receive fresh independent environments at each generation reset.
- If no candidate reaches 5 goals within 120 seconds, selection ranks by goals collected, then measured goal-distance progress, then remaining energy.
- An agent that has collected at least one goal is not eliminated when its energy reaches zero.

This is a winner-take-all evolutionary strategy with mutation, not crossover or PPO. The UI shows the current population, generation timer, leader, and retained elite.

## Current limitations

The bundled Nexius neural module uses a simplified global reward/correction adjustment. This is an experimental feedback mechanism, not PPO or action-specific reinforcement learning. The neural runtime exposes validated weight export/import for per-agent evolutionary checkpoints. Weight persistence across browser sessions is not yet included, and the metrics export does not contain neural weights.

The browser environment supplies observations and applies the model's continuous controls through the Nexius runtime frame hook. Collision handling and world boundaries remain environment safeguards.

## Files

- `index.html` — application interface.
- `styles.css` — responsive visual system.
- `wayfinder.js` — canvas environment, controls, and Nexius runtime bridge.
- `Wayfinder.nexius` — the model's Nexius program and neural declaration.
- `vendor/nexius/compiler.js` — bundled Nexius compiler.
- `vendor/nexius/neural.js` — bundled Nexius neural module.
- `WAYFINDER_PLAN.txt` — project design and implementation record.
