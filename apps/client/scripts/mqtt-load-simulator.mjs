#!/usr/bin/env node

import { connectAsync } from "mqtt";
import { performance } from "node:perf_hooks";

const DEFAULTS = {
  url: "mqtt://127.0.0.1:1883",
  prefix: "loadtest",
  topics: 25_000,
  rate: 2_000,
  seconds: 120,
  seedBatch: 500
};

function usage() {
  console.log(`MQTT Rover load simulator

Seeds retained values to build a large namespace, then publishes rotating live updates.

Usage:
  npm run mqtt:simulate -- [options]

Options:
  --url <url>           Broker URL (default: ${DEFAULTS.url})
  --prefix <topic>      Root topic (default: ${DEFAULTS.prefix})
  --topics <count>      Unique topics to seed (default: ${DEFAULTS.topics})
  --rate <messages/s>   Sustained update rate (default: ${DEFAULTS.rate})
  --seconds <count>     Traffic duration; 0 runs until Ctrl+C (default: ${DEFAULTS.seconds})
  --seed-batch <count>  Concurrent retained publishes per seed batch (default: ${DEFAULTS.seedBatch})
  --seed-only           Stop after building the namespace
  --help                Show this help

Examples:
  npm run mqtt:simulate -- --topics 25000 --rate 2000 --seconds 120
  npm run mqtt:simulate -- --topics 100000 --rate 5000 --seconds 300
`);
}

function parsePositiveInteger(value, option, { allowZero = false } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(`${option} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return parsed;
}

function parseArguments(argv) {
  const options = { ...DEFAULTS, seedOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      return value;
    };

    switch (argument) {
      case "--url":
        options.url = next();
        break;
      case "--prefix":
        options.prefix = next().replace(/^\/+|\/+$/g, "");
        break;
      case "--topics":
        options.topics = parsePositiveInteger(next(), argument);
        break;
      case "--rate":
        options.rate = parsePositiveInteger(next(), argument, { allowZero: true });
        break;
      case "--seconds":
        options.seconds = parsePositiveInteger(next(), argument, { allowZero: true });
        break;
      case "--seed-batch":
        options.seedBatch = parsePositiveInteger(next(), argument);
        break;
      case "--seed-only":
        options.seedOnly = true;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (!options.prefix) {
    throw new Error("--prefix cannot be empty");
  }
  return options;
}

function padded(value, width) {
  return String(value).padStart(width, "0");
}

function topicFor(prefix, index) {
  const site = Math.floor(index / 10_000);
  const area = Math.floor(index / 1_000) % 10;
  const line = Math.floor(index / 100) % 10;
  const device = Math.floor(index / 4) % 25;
  const metrics = ["temperature", "pressure", "flow", "state"];
  return `${prefix}/site-${padded(site, 3)}/area-${padded(area, 2)}/line-${padded(line, 2)}/device-${padded(device, 3)}/${metrics[index % metrics.length]}`;
}

function payloadFor(sequence, topicIndex, phase) {
  return JSON.stringify({
    sequence,
    phase,
    value: Number((20 + ((sequence + topicIndex * 17) % 800) / 10).toFixed(1)),
    status: sequence % 97 === 0 ? "warning" : "ok",
    timestamp: new Date().toISOString()
  });
}

function publishAsync(client, topic, payload, options) {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, options, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function seedTopics(client, options) {
  const startedAt = performance.now();
  for (let start = 0; start < options.topics; start += options.seedBatch) {
    const end = Math.min(start + options.seedBatch, options.topics);
    const batch = [];
    for (let index = start; index < end; index += 1) {
      batch.push(
        publishAsync(
          client,
          topicFor(options.prefix, index),
          payloadFor(index, index, "seed"),
          { qos: 0, retain: true }
        )
      );
    }
    await Promise.all(batch);

    if (end === options.topics || end % 5_000 === 0) {
      const elapsedSeconds = Math.max((performance.now() - startedAt) / 1_000, 0.001);
      process.stdout.write(
        `\rSeeded ${end.toLocaleString()}/${options.topics.toLocaleString()} topics (${Math.round(end / elapsedSeconds).toLocaleString()}/s)`
      );
    }
  }
  process.stdout.write("\n");
}

async function runTraffic(client, options) {
  if (options.rate === 0) {
    console.log("Live rate is 0; namespace seed complete.");
    return;
  }

  const startedAt = performance.now();
  let sent = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.log(
    `Publishing ${options.rate.toLocaleString()} msg/s for ${options.seconds === 0 ? "until Ctrl+C" : `${options.seconds}s`}...`
  );

  let nextReport = 1_000;
  while (!stopped) {
    const elapsed = performance.now() - startedAt;
    if (options.seconds > 0 && elapsed >= options.seconds * 1_000) break;

    const target = Math.floor((elapsed * options.rate) / 1_000);
    const catchUpLimit = Math.min(target, sent + options.rate);
    while (sent < catchUpLimit) {
      const topicIndex = sent % options.topics;
      client.publish(
        topicFor(options.prefix, topicIndex),
        payloadFor(sent, topicIndex, "live"),
        { qos: 0, retain: false }
      );
      sent += 1;
    }

    if (elapsed >= nextReport) {
      const actualRate = Math.round(sent / (elapsed / 1_000));
      process.stdout.write(
        `\rSent ${sent.toLocaleString()} live messages (average ${actualRate.toLocaleString()} msg/s)`
      );
      nextReport += 1_000;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const elapsedSeconds = Math.max((performance.now() - startedAt) / 1_000, 0.001);
  console.log(
    `\nFinished ${sent.toLocaleString()} live messages in ${elapsedSeconds.toFixed(1)}s (${Math.round(sent / elapsedSeconds).toLocaleString()} msg/s average).`
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  console.log(`Connecting to ${options.url}...`);
  const client = await connectAsync(options.url, {
    protocolVersion: 5,
    clientId: `mqtt-rover-load-${process.pid}-${Date.now()}`,
    clean: true,
    reconnectPeriod: 0
  });

  client.on("error", (error) => {
    console.error(`Broker error: ${error.message}`);
  });

  try {
    console.log(
      `Seeding ${options.topics.toLocaleString()} retained topics below ${options.prefix}/#...`
    );
    await seedTopics(client, options);
    if (!options.seedOnly) await runTraffic(client, options);
  } finally {
    await client.endAsync();
  }
}

main().catch((error) => {
  console.error(`Load simulation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
