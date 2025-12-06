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
            percentile: 0.95, // optional
            min_players_for_percentile: 70, //optional, but required if percentile setup
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
      this.registerListCommands(balance.commands, (data) => this.processBalanceCommand(data, balance));
    }
  }

  /**
   *
   * @param {*} data
   * @param {BalanceConfigMockUp} balanceConfig
   */
  async processBalanceCommand(data, balanceConfig) {
    let teamOneSteamIDs = this.getSteamIDsByConfig(1, balanceConfig);
    let teamTwoSteamIDs = this.getSteamIDsByConfig(2, balanceConfig);

    let playtimes = await this.requestHoursBySteamIDs([...teamOneSteamIDs, ...teamTwoSteamIDs]);

    if (playtimes === TIME_IS_UNKNOWN) {
      await this.server.rcon.warn(data.player.steamID, "Ошибка при расчете баланса, повторите позже");
      return;
    }

    let sumHours = playtimes.reduce((prev, curr) => prev + curr.playtime, 0);

    let isPercentileCalculated;
    [playtimes, isPercentileCalculated] = this.trimPercentile(
      playtimes,
      balanceConfig.percentile,
      balanceConfig.min_players_for_percentile
    );

    let sumTeamOne = 0;
    let sumTeamTwo = 0;

    for (let playtime of playtimes) {
      if (teamOneSteamIDs.has(playtime.steamID)) {
        sumTeamOne += playtime.playtime;
      } else if (teamTwoSteamIDs.has(playtime.steamID)) {
        sumTeamTwo += playtime.playtime;
      }
    }

    if (sumTeamOne + sumTeamTwo === 0) {
      await this.server.rcon.broadcast(`Баланс ${balanceConfig.name} неизвестен`);
      return;
    }

    await this.broadcastBalance(
      balanceConfig.name,
      sumTeamOne,
      sumTeamTwo,
      sumHours,
      isPercentileCalculated ? balanceConfig.percentile : null
    );
  }

  /**
   *
   * @param {string} name
   * @param {number} sumTeamOnePercentile
   * @param {number} sumTeamTwoPercentile
   * @param {number} sumHoursAbsolute
   */
  async broadcastBalance(name, sumTeamOnePercentile, sumTeamTwoPercentile, sumHoursAbsolute, percentile) {
    const teamOnePercent = ((sumTeamOnePercentile / (sumTeamOnePercentile + sumTeamTwoPercentile)) * 100).toFixed(0);
    const teamTwoPercent = ((sumTeamTwoPercentile / (sumTeamOnePercentile + sumTeamTwoPercentile)) * 100).toFixed(0);

    let percentileMessage = percentile ? ` | по ${percentile * 100}% игроков` : "";

    let message = `Баланс ${name}: ${teamOnePercent}% VS ${teamTwoPercent}% │ ${sumTeamOnePercentile.toFixed(0)} VS ${sumTeamTwoPercentile.toFixed(0)} часов${percentileMessage}
Всего ${sumHoursAbsolute.toFixed(0)} часов`;

    this.verbose(1, message);
    await this.server.rcon.broadcast(message);
  }

  /**
   *
   * @param {number} teamID
   * @param {BalanceConfigMockUp} balanceConfig
   */
  getSteamIDsByConfig(teamID, balanceConfig) {
    if (balanceConfig.is_cmd) {
      return new Set(
        this.server.players
          .filter(
            (player) => player.teamID === teamID && player.isLeader && player.squad?.squadName === "Command Squad"
          )
          .map((player) => player.steamID)
      );
    } else {
      return new Set(
        this.server.players
          .filter(
            (player) =>
              player.teamID === teamID &&
              (balanceConfig.is_leader !== undefined ? player.isLeader === balanceConfig.is_leader : true) &&
              (balanceConfig.role_regex ? player.role.match(balanceConfig.role_regex) : true)
          )
          .map((player) => player.steamID)
      );
    }
  }

  /**
   *
   * @param {PlaytimeInfo[]} playtimes
   * @param {number} percentile
   * @param {number} min_players_for_percentile
   */
  trimPercentile(playtimes, percentile, min_players_for_percentile) {
    if (
      playtimes.length > 0 &&
      percentile &&
      min_players_for_percentile != undefined &&
      playtimes.length >= min_players_for_percentile
    ) {
      let sortedPlaytimes = playtimes.sort((a, b) => a.playtime - b.playtime);
      return [sortedPlaytimes.slice(0, Math.floor(sortedPlaytimes.length * percentile)), true];
    }

    return [playtimes, false];
  }

  /**
   *
   * @param {string[]} steamIDs
   * @returns {Promise<PlaytimeInfo[] | TIME_IS_UNKNOWN>}
   */
  async requestHoursBySteamIDs(steamIDs) {
    if (steamIDs.length == 0) {
      return [];
    }

    try {
      let playtimeObjects = await this.playtimeAPI.requestPlaytimesBySteamIDs(steamIDs);

      return playtimeObjects.map(
        (playtimeObject) =>
          new PlaytimeInfo(
            playtimeObject.steamID,
            Math.max(playtimeObject.bmPlaytime, playtimeObject.steamPlaytime) / 60 / 60
          )
      );
    } catch (error) {
      this.verbose(1, `Failed to get playtime with error: ${error}`);
      return TIME_IS_UNKNOWN;
    }
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
}

class PlaytimeInfo {
  constructor(steamID, playtime) {
    this.steamID = steamID;
    this.playtime = playtime;
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
    this.percentile = 1;
    this.min_players_for_percentile = 70;
  }
}
