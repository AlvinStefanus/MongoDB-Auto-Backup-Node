import {
  LocalFileSystemDuplexConnector,
  MongoDBDuplexConnector,
  MongoTransferer,
} from "mongodb-snapshot";
import { scheduleJob, Job } from "node-schedule";
import "dotenv/config";
import fs from "fs";
import path from "path";

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function nameGenerator() {
  const now = new Date();
  const name = `${now.getDate()}-${
    monthNames[now.getMonth()]
  }-${now.getFullYear()}`;

  if (process.env["USE_TIMESTAMP"]) {
    // Add hour, minute and second to the name
    return `${name}-${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}.tar`;
  }

  return `${name}.tar`;
}

function createBackupFolder() {
  // Create backup folder if not exists
  const fs = require("fs");
  const directory = process.env["BACKUP_TO_LOCAL_PATH"];
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
  }
}

async function backupDB() {
  createBackupFolder();

  const mongo_connector = new MongoDBDuplexConnector({
    connection: {
      uri: process.env["DB_URL"]!,
      dbname: process.env["DB_NAME"]!,
    },
  });

  const localfile_connector = new LocalFileSystemDuplexConnector({
    connection: {
      path: path.join(process.env["BACKUP_TO_LOCAL_PATH"]!, nameGenerator()),
    },
  });

  const transferer = new MongoTransferer({
    source: mongo_connector,
    targets: [localfile_connector],
  });

  for await (const { total, write } of transferer) {
    console.log(`remaining bytes to write: ${total - write}`);
  }
}

function deleteOldBackups() {
  createBackupFolder();

  const fs = require("fs");
  const directory = process.env["BACKUP_TO_LOCAL_PATH"]!;
  fs.readdir(directory, (err: any, files: any) => {
    if (err) throw err;

    if (files.length > parseInt(process.env["KEEP_BACKUP_FILES"]!)) {
      //Delete the oldest files
      files
        .sort((a: any, b: any) => {
          return (
            fs.statSync(path.join(directory, a)).mtime.getTime() -
            fs.statSync(path.join(directory, b)).mtime.getTime()
          );
        })
        .slice(0, files.length - parseInt(process.env["KEEP_BACKUP_FILES"]!))
        .forEach((file: any) => {
          console.log(`Deleting ${file}`);
          fs.unlinkSync(path.join(directory, file));
          console.log(`Deleted ${file}`);
        });
    }
  });
}

// ---------------------------------------------------------------------------
// Startup diagnostics
// ---------------------------------------------------------------------------

// Hide the password when printing the connection string.
function maskDbUrl(url: string | undefined): string {
  if (!url) return "(not set)";
  return url.replace(/(\/\/[^:]+:)([^@]+)(@)/, "$1****$3");
}

// Turn a future date into something like "in 45 minutes" / "in 1 hour 5 minutes".
function humanizeTimeLeft(target: Date): string {
  let diff = Math.max(0, target.getTime() - Date.now());
  const sec = Math.floor(diff / 1000) % 60;
  const min = Math.floor(diff / (1000 * 60)) % 60;
  const hrs = Math.floor(diff / (1000 * 60 * 60)) % 24;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  const parts: string[] = [];
  if (days) parts.push(`${days} day${days > 1 ? "s" : ""}`);
  if (hrs) parts.push(`${hrs} hour${hrs > 1 ? "s" : ""}`);
  if (min) parts.push(`${min} minute${min > 1 ? "s" : ""}`);
  if (!days && !hrs && !min) parts.push(`${sec} second${sec !== 1 ? "s" : ""}`);

  return `in ${parts.join(" ")}`;
}

// 1. Is the database connection correct?
async function checkDatabaseConnection(): Promise<boolean> {
  const uri = process.env["DB_URL"];
  const dbName = process.env["DB_NAME"];
  if (!uri || !dbName) {
    console.log("  [DB]       ✗ DB_URL or DB_NAME is not set (check your .env)");
    return false;
  }

  // mongodb v3 (pulled in by mongodb-snapshot) ships no TS types, so require it.
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    useUnifiedTopology: true,
  });
  try {
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    console.log(`  [DB]       ✓ Connected to MongoDB, database "${dbName}" reachable`);
    return true;
  } catch (err) {
    console.log(`  [DB]       ✗ Cannot connect to MongoDB: ${(err as Error).message}`);
    return false;
  } finally {
    await client.close().catch(() => {});
  }
}

// 3. Is the backup folder set up correctly?
function checkBackupFolder(): boolean {
  const dir = process.env["BACKUP_TO_LOCAL_PATH"];
  if (!dir) {
    console.log("  [Folder]   ✗ BACKUP_TO_LOCAL_PATH is not set (check your .env)");
    return false;
  }

  const abs = path.resolve(dir);
  try {
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(abs, { recursive: true });
      console.log(`  [Folder]   ✓ Backup folder created: ${abs}`);
      return true;
    }
    if (!fs.statSync(abs).isDirectory()) {
      console.log(`  [Folder]   ✗ Path exists but is not a directory: ${abs}`);
      return false;
    }
    const count = fs.readdirSync(abs).filter((f) => f.endsWith(".tar")).length;
    console.log(`  [Folder]   ✓ Backup folder ready: ${abs} (${count} existing backup${count !== 1 ? "s" : ""})`);
    return true;
  } catch (err) {
    console.log(`  [Folder]   ✗ Problem with backup folder: ${(err as Error).message}`);
    return false;
  }
}

function startSchedule(): Job | null {
  const schedule = process.env["SCHEDULE_TIME"];
  if (!schedule) {
    console.log("  [Schedule] ✗ SCHEDULE_TIME is not set (check your .env)");
    return null;
  }

  const job = scheduleJob(schedule, async () => {
    console.log(`[${new Date().toLocaleString()}] Backup started`);
    await backupDB();
    deleteOldBackups();
    console.log(`[${new Date().toLocaleString()}] Backup completed`);
  });

  if (!job) {
    console.log(`  [Schedule] ✗ Invalid schedule pattern: "${schedule}"`);
    return null;
  }
  return job;
}

async function main() {
  console.log("=================================================");
  console.log("  MongoDB Auto Backup — starting up");
  console.log("=================================================");

  console.log("Configuration:");
  console.log(`  Database URL    : ${maskDbUrl(process.env["DB_URL"])}`);
  console.log(`  Database name   : ${process.env["DB_NAME"] || "(not set)"}`);
  console.log(`  Schedule (cron) : ${process.env["SCHEDULE_TIME"] || "(not set)"}`);
  console.log(`  Backup folder   : ${process.env["BACKUP_TO_LOCAL_PATH"] || "(not set)"}`);
  console.log(`  Keep files      : ${process.env["KEEP_BACKUP_FILES"] || "(not set)"}`);
  console.log(`  Timestamped     : ${process.env["USE_TIMESTAMP"] === "true"}`);
  console.log("");

  console.log("Checks:");
  // 1. DB connection, 3. backup folder
  const dbOk = await checkDatabaseConnection();
  const folderOk = checkBackupFolder();

  // 2. Schedule + next backup time with time left
  const job = startSchedule();
  if (job) {
    const next = job.nextInvocation() as unknown as Date;
    console.log(
      `  [Schedule] ✓ Next backup: ${next.toLocaleString()} (${humanizeTimeLeft(next)})`
    );
  }

  console.log("");
  if (dbOk && folderOk && job) {
    console.log("✓ Ready. Waiting for the next scheduled backup. Press Ctrl+C to stop.");
  } else {
    console.log("⚠ Started with warnings — review the ✗ items above. The process will keep running.");
  }
}

main();
