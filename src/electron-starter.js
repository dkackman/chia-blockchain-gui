//handle setupevents as quickly as possible
const setupEvents = require("./setupEvents");

if (!setupEvents.handleSquirrelEvent()) {
  // squirrel event handled and app will exit in 1000ms, so don't do anything else
  const {
    app,
    dialog,
    shell,
    ipcMain,
    BrowserWindow,
    Menu
  } = require("electron");
  const openAboutWindow = require("about-window").default;
  const path = require("path");
  const dev_config = require("./dev_config");
  const chiaConfig = require("./util/config");
  const local_test = require('./config/config').local_test;
  const url = require("url");
  const os = require("os");

  const ensureSingleInstance = () => {
    const gotTheLock = app.requestSingleInstanceLock();

    if (!gotTheLock) {
      app.quit();
    } else {
      app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.focus();
        }
      });
    }
  };

  /*************************************************************
   * py process
   *************************************************************/
  const PY_MAC_DIST_FOLDER = "../../app.asar.unpacked/daemon";
  const PY_WIN_DIST_FOLDER = "../../app.asar.unpacked/daemon";
  const PY_DIST_FILE = "daemon";
  const PY_FOLDER = "../src/daemon";
  const PY_MODULE = "server"; // without .py suffix

  let pyProc = null;
  let have_cert = null;
  
  ensureSingleInstance();

  // this needs to happen early in startup so all processes share the same global config
  chiaConfig.loadConfig();
  global.sharedObj = { local_test: local_test };

  const exitPyProc = e => {};

  app.on("will-quit", exitPyProc);

  /*************************************************************
   * window management
   *************************************************************/
  let mainWindow = null;
  let decidedToClose = false;

  app.on("ready", async () => {
    app.applicationMenu = createMenu();
    createPyProc();
    createWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("activate", () => {
    if (mainWindow === null) {
      createWindow();
    }
  });

  ipcMain.on("load-page", (event, arg) => {
    mainWindow.loadURL(
      require("url").format({
        pathname: path.join(__dirname, arg.file),
        protocol: "file:",
        slashes: true
      }) + arg.query
    );
  });

  const guessPackaged = () => {
    let packed;
    if (process.platform === "win32") {
      const fullPath = path.join(__dirname, PY_WIN_DIST_FOLDER);
      packed = require("fs").existsSync(fullPath);
      console.log(fullPath);
      console.log(packed);
      return packed;
    }
    const fullPath = path.join(__dirname, PY_MAC_DIST_FOLDER);
    packed = require("fs").existsSync(fullPath);
    console.log(fullPath);
    console.log(packed);
    return packed;
  };

  const getScriptPath = () => {
    if (!guessPackaged()) {
      return path.join(PY_FOLDER, PY_MODULE + ".py");
    }
    if (process.platform === "win32") {
      return path.join(__dirname, PY_WIN_DIST_FOLDER, PY_DIST_FILE + ".exe");
    }
    return path.join(__dirname, PY_MAC_DIST_FOLDER, PY_DIST_FILE);
  };

  const createPyProc = () => {
    // if the daemon isn't local we aren't going to try to start/stop it
    if (!chiaConfig.manageDaemonLifetime()) {
      return;
    }

    let script = getScriptPath();
    let processOptions = {};
    //processOptions.detached = true;
    //processOptions.stdio = "ignore";
    pyProc = null;
    if (guessPackaged()) {
      try {
        console.log("Running python executable: ");
        const Process = require("child_process").spawn;
        pyProc = new Process(script, [], processOptions);
      } catch (e) {
        console.log("Running python executable: Error: ");
        console.log("Script " + script);
      }
    } else {
      console.log("Running python script");
      console.log("Script " + script);

      const Process = require("child_process").spawn;
      pyProc = new Process("python", [script], processOptions);
    }
    if (pyProc != null) {
      pyProc.stdout.setEncoding("utf8");

      pyProc.stdout.on("data", function(data) {
        if (!have_cert) {
          process.stdout.write("No cert\n");
          // listen for ssl path message
          try {
            let str_arr = data.toString().split("\n");
            for (var i = 0; i < str_arr.length; i++) {
              let str = str_arr[i];
              try {
                let json = JSON.parse(str);
                global.cert_path = json["cert"]; //jshint ignore:line
                global.key_path = json["key"]; //jshint ignore:line
                if (cert_path && key_path) {
                  have_cert = true;
                  process.stdout.write("Have cert\n");
                  return;
                }
              } catch (e) {
              }
            }
          } catch (e) {
          }
        }

        process.stdout.write(data.toString());
      });

      pyProc.stderr.setEncoding("utf8");
      pyProc.stderr.on("data", function(data) {
        //Here is where the error output goes
        process.stdout.write("stderr: " + data.toString());
      });

      pyProc.on("close", function(code) {
        //Here you can get the exit code of the script
        console.log("closing code: " + code);
      });

      console.log("child process success");
    }
    //pyProc.unref();
  };
  
  const createWindow = () => {
    decidedToClose = false;
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 1200,
      minWidth: 500,
      minHeight: 500,
      backgroundColor: "#ffffff",
      show: false,
      webPreferences: {
        preload: __dirname + "/preload.js",
        nodeIntegration: true
      }
    });

    if (dev_config.redux_tool) {
      BrowserWindow.addDevToolsExtension(
        path.join(os.homedir(), dev_config.redux_tool)
      );
    }

    if (dev_config.react_tool) {
      BrowserWindow.addDevToolsExtension(
        path.join(os.homedir(), dev_config.react_tool)
      );
    }

    var startUrl =
      process.env.ELECTRON_START_URL ||
      url.format({
        pathname: path.join(__dirname, "/../build/index.html"),
        protocol: "file:",
        slashes: true
      });

    mainWindow.loadURL(startUrl);

    mainWindow.once("ready-to-show", function() {
      mainWindow.show();
    });

    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.setTitle(`${app.getName()} [${global.daemon_rpc_ws}]`);
    });

    // Uncomment this to open devtools by default
    // if (!guessPackaged()) {
    //   mainWindow.webContents.openDevTools();
    // }
    mainWindow.on("close", e => {
      // if the daemon isn't local we aren't going to try to start/stop it
      if (decidedToClose || !chiaConfig.manageDaemonLifetime()) {
        return;
      }
      e.preventDefault();
      var choice = dialog.showMessageBoxSync({
        type: "question",
        buttons: ["No", "Yes"],
        title: "Confirm",
        message:
          "Are you sure you want to quit? GUI Plotting and farming will stop."
      });
      if (choice == 0) {
        return;
      }
      decidedToClose = true;
      mainWindow.webContents.send("exit-daemon");
      mainWindow.setBounds({ height: 500, width: 500 });
      ipcMain.on("daemon-exited", (event, args) => {
        mainWindow.close();
      });
    });
  };

  const createMenu = () => {
    const menu = Menu.buildFromTemplate(getMenuTemplate());
    return menu;
  };

  const getMenuTemplate = () => {
    const template = [
      {
        label: "File",
        submenu: [
          {
            role: "quit"
          }
        ]
      },
      {
        label: "Edit",
        submenu: [
          {
            role: "undo"
          },
          {
            role: "redo"
          },
          {
            type: "separator"
          },
          {
            role: "cut"
          },
          {
            role: "copy"
          },
          {
            role: "paste"
          },
          {
            role: "delete"
          },
          {
            type: "separator"
          },
          {
            role: "selectall"
          }
        ]
      },
      {
        label: "View",
        submenu: [
          {
            role: "reload"
          },
          {
            role: "forcereload"
          },
          {
            label: "Developer",
            submenu: [
              {
                label: "Developer Tools",
                accelerator:
                  process.platform === "darwin"
                    ? "Alt+Command+I" //jshint ignore:line
                    : "Ctrl+Shift+I",
                click: () => mainWindow.toggleDevTools()
              }
            ]
          },
          {
            type: "separator"
          },
          {
            role: "resetzoom"
          },
          {
            role: "zoomin"
          },
          {
            role: "zoomout"
          },
          {
            type: "separator"
          },
          {
            label: "Full Screen",
            type: "checkbox",
            accelerator: process.platform === "darwin" ? "Ctrl+Command+F" : "F11",
            click: () => windows.main.toggleFullScreen()
          }
        ]
      },
      {
        label: "Window",
        submenu: [
          {
            role: "minimize"
          },
          {
            role: "zoom"
          },
          {
            role: "close"
          }
        ]
      },
      {
        label: "Help",
        role: "help",
        submenu: [
          {
            label: "Chia Blockchain Wiki",
            click: () => {
              openExternal(
                "https://github.com/Chia-Network/chia-blockchain/wiki"
              );
            }
          },
          {
            label: "Frequently Asked Questions",
            click: () => {
              openExternal(
                "https://github.com/Chia-Network/chia-blockchain/wiki/FAQ"
              );
            }
          },
          {
            label: "Release Notes",
            click: () => {
              openExternal(
                "https://github.com/Chia-Network/chia-blockchain/releases"
              );
            }
          },
          {
            label: "Contribute on GitHub",
            click: () => {
              openExternal(
                "https://github.com/Chia-Network/chia-blockchain/blob/master/CONTRIBUTING.md"
              );
            }
          },
          {
            type: "separator"
          },
          {
            label: "Report an Issue...",
            click: () => {
              openExternal(
                "https://github.com/Chia-Network/chia-blockchain/issues"
              );
            }
          },
          {
            label: "Chat on KeyBase",
            click: () => {
              openExternal("https://keybase.io/team/chia_network.public");
            }
          },
          {
            label: "Follow on Twitter",
            click: () => {
              openExternal("https://twitter.com/chia_project");
            }
          }
        ]
      }
    ];

    if (process.platform === "darwin") {
      // Chia Blockchain menu (Mac)
      template.unshift({
        label: "Chia",
        submenu: [
          {
            label: "About " + "Chia Blockchain",
            click: () =>
              openAboutWindow({
                homepage: "https://www.chia.net/",
                bug_report_url:
                  "https://github.com/Chia-Network/chia-blockchain/issues",
                icon_path: path.join(__dirname, "assets/img/chia_circle.png"),
                copyright: "Copyright (c) 2021 Chia Network",
                license: "Apache 2.0"
              })
          },
          {
            type: "separator"
          },
          {
            role: "services"
          },
          {
            type: "separator"
          },
          {
            role: "hide"
          },
          {
            role: "hideothers"
          },
          {
            role: "unhide"
          },
          {
            type: "separator"
          },
          {
            role: "quit"
          }
        ]
      });

      // File menu (MacOS)
      template.splice(1, 1, {
        label: "File",
        submenu: [
          {
            role: "close"
          }
        ]
      });

      // Edit menu (MacOS)
      template[2].submenu.push(
        {
          type: "separator"
        },
        {
          label: "Speech",
          submenu: [
            {
              role: "startspeaking"
            },
            {
              role: "stopspeaking"
            }
          ]
        }
      );

      // Window menu (MacOS)
      template.splice(4, 1, {
        role: "window",
        submenu: [
          {
            role: "minimize"
          },
          {
            role: "zoom"
          },
          {
            type: "separator"
          },
          {
            role: "front"
          }
        ]
      });
    }

    if (process.platform === "linux" || process.platform === "win32") {
      // Help menu (Windows, Linux)
      template[4].submenu.push(
        {
          type: "separator"
        },
        {
          label: "About " + "Chia Blockchain",
          click: () =>
            openAboutWindow({
              homepage: "https://www.chia.net/",
              bug_report_url:
                "https://github.com/Chia-Network/chia-blockchain/issues",
              icon_path: path.join(__dirname, "assets/img/chia_circle.png"),
              copyright: "Copyright (c) 2021 Chia Network",
              license: "Apache 2.0"
            })
        }
      );
    }

    return template;
  };

  /**
   * Open the given external protocol URL in the desktop’s default manner.
   */
  const openExternal= (url) => {
    // console.log(`openExternal: ${url}`)
    shell.openExternal(url);
  };
}
