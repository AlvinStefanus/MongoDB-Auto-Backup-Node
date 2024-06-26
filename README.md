# Node Typescript MongoDB Auto Backup

Program to auto backup mongodb using NodeJS.

Run `npm i` to install the dependencies.

### Schedule the backup

In the `.env` file:

> `SCHEDULE_TIME='0 * * * *'`

This is based on the npm package `node-schedule`. Read their documentation in here [https://github.com/node-schedule/node-schedule](https://github.com/node-schedule/node-schedule).

> `KEEP_BACKUP_FILES=7` 

This means that the ***maximum number*** of backup files stored in the `KEEP_BACKUP_FILES` is `7`. Change the number to store more or less, but please be cautious, ***large files will take a lot of disk space***.

> `USE_TIMESTAMP=false` 

If this is set to true, in every backup files they will have ***timestamp suffix***. This can be used to keep the backups if saved every ***hour or minute***. Because the same backup file name will be ***overwriten***. If your schedule is set every hour and `USE_TIMESTAMP=false`, this means that the backup file names will be the ***same within the same day***, which causes the previous backup file will be ***overwriten***.

### Running The Program

First, build the program using `npm run build`, then run `npm run start` or `npm start`.

### Deploy Only The Dist Folder Without Source Code

If you want to deploy the build folder only `dist` in your web hosting. Run this `npm run deploy`. This will build your app and also copied the `package.json` into the dist folder. Then in your hosting provider, run `npm i` and `npm start` on the `dist` folder.