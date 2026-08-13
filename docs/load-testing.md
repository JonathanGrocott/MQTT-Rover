# Local MQTT load testing

The repository includes a loopback-only Mosquitto broker and a configurable publisher. Use this setup for high-volume testing; shared public brokers are suitable for connection checks, not load generation.

## Quick start on macOS

Prerequisites: Node.js/npm, Docker Desktop, and a successful `npm install` from the repository root.

Start the test broker:

```sh
npm run broker:test:up
```

Start MQTT Rover in a second terminal:

```sh
npm run electron:dev
```

In the **Local Mosquitto** profile, change the protocol from `ws` to `mqtt`, set the host to `127.0.0.1`, set the port to `1883`, and leave the path empty. Subscribe to `loadtest/#`, use QoS 0, and start with the **Subtle** topic activity mode.

In a third terminal, run the normal stress profile:

```sh
npm run mqtt:simulate -- --topics 25000 --rate 2000 --seconds 120
```

Then test the current design target of 100,000 topics and 5,000 messages per second:

```sh
npm run mqtt:simulate -- --topics 100000 --rate 5000 --seconds 300
```

The simulator first publishes one retained message per unique topic so the tree becomes full. It then rotates live, non-retained updates across those topics. Use `--seconds 0` to run until Ctrl+C, `--seed-only` to test tree population without sustained traffic, or `--help` for all options.

Stop and remove the disposable broker when finished:

```sh
npm run broker:test:down
```

Stopping the broker clears all retained test data because persistence is disabled.

## Useful test progression

1. Baseline: 10,000 topics at 500 msg/s.
2. Normal stress: 25,000 topics at 2,000 msg/s.
3. Design target: 100,000 topics at 5,000 msg/s.
4. Soak: use the design target with `--seconds 0` and watch memory, CPU, responsiveness, and dropped-message counters for 15–30 minutes.

Compare Off, Subtle, and Full activity modes at the same rate. Full is intentionally more animated and is most useful at lower rates; Subtle should remain readable during the design-target test.
