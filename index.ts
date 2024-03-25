import {
  LocalFileSystemDuplexConnector,
  MongoDBDuplexConnector,
  MongoTransferer,
} from "mongodb-snapshot";
import { scheduleJob } from "node-schedule";
import "dotenv/config";
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
      uri: process.env["DB_URL"],
      dbname: process.env["DB_NAME"],
    },
  });

  const localfile_connector = new LocalFileSystemDuplexConnector({
    connection: {
      path: path.join(process.env["BACKUP_TO_LOCAL_PATH"], nameGenerator()),
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
  const directory = process.env["BACKUP_TO_LOCAL_PATH"];
  fs.readdir(directory, (err: any, files: any) => {
    if (err) throw err;

    if (files.length > process.env["KEEP_BACKUP_FILES"]) {
      //Delete the oldest files
      files
        .sort((a: any, b: any) => {
          return (
            fs.statSync(path.join(directory, a)).mtime.getTime() -
            fs.statSync(path.join(directory, b)).mtime.getTime()
          );
        })
        .slice(0, files.length - (process.env["KEEP_BACKUP_FILES"] as any))
        .forEach((file: any) => {
          console.log(`Deleting ${file}`);
          fs.unlinkSync(path.join(directory, file));
          console.log(`Deleted ${file}`);
        });
    }
  });
}

function startSchedule() {
  scheduleJob(process.env["SCHEDULE_TIME"], async () => {
    console.log("Backup started");
    await backupDB();
    deleteOldBackups();
    console.log("Backup completed");
  });
}

startSchedule();
