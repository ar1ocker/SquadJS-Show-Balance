//@ts-check
import BasePlugin from "./base-plugin.js";
import { default as PlaytimeServiceAPI, TIME_IS_UNKNOWN } from "./playtime-service-api.js";

const SQUAD_GAME_ID = 393380;

//@ts-ignore
export default class ServerPlaytimeBalance extends BasePlugin {
  static get description() {
    return "The playtime balance of teams";
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      balances: {
        required: true,
        description: "list of balances",
        example: [
          {
            commands: ["command1"],
            name: "name1",
            role_regex: "", // optional, regex of player role
            is_leader: false, // optional, true or false
            is_cmd: true, // optional, true or not defined
          },
        ],
      },
      playtime_service_api_url: {
        required: true,
        description: "URL to Playtime Service API",
        default: "",
      },
      playtime_service_api_secret_key: {
        required: true,
        description: "Secret key for Playtime Service API",
        default: "",
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.playtimeAPI = new PlaytimeServiceAPI(
      this.options.playtime_service_api_url,
      this.options.playtime_service_api_secret_key,
      SQUAD_GAME_ID
    );
  }

  async mount() {
    for (const balance of this.options.balances) {
      this.registerListCommands(balance.commands, (data) => this.calculateAndBroadcastBalance(data, balance));
    }
  }

  /**
   *
   * @param {*} data
   * @param {BalanceConfigMockUp} balanceConfig
   */
  async calculateAndBroadcastBalance(data, balanceConfig) {
    let teamOneSteamIDs;
    let teamTwoSteamIDs;

    if (balanceConfig.is_cmd) {
      teamOneSteamIDs = this.server.players
        .filter((player) => player.teamID === 1 && player.isLeader && player.squad?.squadName === "Command Squad")
        .map((player) => player.steamID);

      teamTwoSteamIDs = this.server.players
        .filter((player) => player.teamID === 2 && player.isLeader && player.squad?.squadName === "Command Squad")
        .map((player) => player.steamID);
    } else {
      teamOneSteamIDs = this.server.players
        .filter(
          (player) =>
            player.teamID === 1 &&
            (balanceConfig.is_leader !== undefined ? player.isLeader === balanceConfig.is_leader : true) &&
            (balanceConfig.role_regex ? player.role.match(balanceConfig.role_regex) : true)
        )
        .map((player) => player.steamID);

      teamTwoSteamIDs = this.server.players
        .filter(
          (player) =>
            player.teamID === 2 &&
            (balanceConfig.is_leader !== undefined ? player.isLeader === balanceConfig.is_leader : true) &&
            (balanceConfig.role_regex ? player.role.match(balanceConfig.role_regex) : true)
        )
        .map((player) => player.steamID);
    }

    await this.broadcastBalanceByPlayers(data.player, teamOneSteamIDs, teamTwoSteamIDs, balanceConfig.name);
  }

  async broadcastBalanceByPlayers(requestPlayer, playersOne, playersTwo, balanceName) {
    let [onePlaytime, twoPlaytime] = [0, 0];

    if (playersOne.length > 0 && playersTwo.length > 0) {
      // @ts-ignore
      [onePlaytime, twoPlaytime] = await Promise.all([
        this.calculateHoursBySteamIDs(playersOne),
        this.calculateHoursBySteamIDs(playersTwo),
      ]);
    } else if (playersOne.length > 0) {
      // @ts-ignore
      onePlaytime = await this.calculateHoursBySteamIDs(playersOne);
    } else if (playersTwo.length > 0) {
      // @ts-ignore
      twoPlaytime = await this.calculateHoursBySteamIDs(playersTwo);
    }

    if (onePlaytime === TIME_IS_UNKNOWN || twoPlaytime === TIME_IS_UNKNOWN) {
      await this.server.rcon.warn(requestPlayer.steamID, "Ошибка при расчете баланса, повторите позже");
      return;
    }

    let sumPercent = onePlaytime + twoPlaytime;

    if (sumPercent === 0) {
      await this.server.rcon.broadcast(`Баланс ${balanceName} неизвестен`);
      return;
    }

    const onePercent = ((onePlaytime / sumPercent) * 100).toFixed(0);
    const twoPercent = ((twoPlaytime / sumPercent) * 100).toFixed(0);

    await this.server.rcon.broadcast(
      `Баланс ${balanceName}: ${onePercent}% VS ${twoPercent}%  │  ${onePlaytime.toFixed(0)} VS ${twoPlaytime.toFixed(0)} часов  
Всего ${(onePlaytime + twoPlaytime).toFixed(0)} часов`
    );
  }

  /**
   *
   * @param {Array<string>} commands
   * @param {Function} func
   */
  registerListCommands(commands, func) {
    for (const command of commands) {
      this.server.on(`CHAT_COMMAND:${command.toLowerCase()}`, func);
    }
  }

  /**
   *
   * @param {Array<string>} steamIDs
   * @returns {Promise<number | TIME_IS_UNKNOWN>}
   */
  async calculateHoursBySteamIDs(steamIDs) {
    try {
      return (await this.playtimeAPI.getPlayersTotalSecondsPlaytime(steamIDs)) / 60 / 60;
    } catch (error) {
      this.verbose(1, `Failed to get playtime with error: ${error}`);
      return TIME_IS_UNKNOWN;
    }
  }
}

// eslint-disable-next-line no-unused-vars
class BalanceConfigMockUp {
  constructor() {
    this.commands = new Array();
    this.name = "";
    this.role_regex = "";
    this.is_leader = false;
    this.is_cmd = true;
  }
}
