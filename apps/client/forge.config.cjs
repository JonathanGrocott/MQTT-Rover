const { MakerDMG } = require("@electron-forge/maker-dmg");
const { MakerSquirrel } = require("@electron-forge/maker-squirrel");
const { MakerZIP } = require("@electron-forge/maker-zip");

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "mqtt-rover"
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "mqtt_rover",
      authors: "MQTT Rover",
      description: "A modern MQTT explorer for desktop"
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({}, ["darwin"])
  ]
};
