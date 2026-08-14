const { MakerDMG } = require("@electron-forge/maker-dmg");
const { MakerSquirrel } = require("@electron-forge/maker-squirrel");
const { MakerZIP } = require("@electron-forge/maker-zip");
const path = require("node:path");

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "mqtt-rover",
    icon: path.join(__dirname, "assets", "icon"),
    prune: false,
    ignore: [/^\/node_modules(?:\/|$)/, /^\/out(?:\/|$)/]
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "mqtt_rover",
      authors: "MQTT Rover",
      description: "A modern MQTT explorer for desktop",
      setupIcon: path.join(__dirname, "assets", "icon.ico")
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({}, ["darwin"])
  ]
};
