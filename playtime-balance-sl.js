import BasePlugin from "./base-plugin.js";
import { default as PlaytimeSearcher, TIME_IS_UNKNOWN } from "./playtime-searcher.js";

const SQUAD_GAME_ID = 393380;

export default class PlaytimeBalanceSL extends BasePlugin {
  static get description() {
    return "The playtime balance of sl`s";
  }

  static get defaultEnabled() {
    return false;
  }

  static get optionsSpecification() {
    return {
      steam_key: {
        required: true,
        description: "The steam api key",
        default: "",
      },
    };
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);

    this.steam_api = new PlaytimeSearcher(this.options.steam_key);

    this.onCommand = this.onCommand.bind(this);
  }

  async mount() {
    this.server.on("CHAT_COMMAND:slbalance", this.onCommand);
    this.server.on("CHAT_COMMAND:слбаланс", this.onCommand);
    this.server.on("CHAT_COMMAND:сквадные", this.onCommand);
  }

  async calculateHoursByTeam(teamID) {
    let playtimesOfTeam = await Promise.all(
      this.server.players.map(async (player) => {
        if (player.teamID != teamID) {
          return 0;
        }

        if (!player.isLeader) {
          return 0;
        }

        let playtimeObj = await this.steam_api.getPlaytimeByGame(player.steamID, SQUAD_GAME_ID);

        if (playtimeObj.playtime === TIME_IS_UNKNOWN) {
          return 0;
        }
        return playtimeObj.playtime;
      })
    );

    return playtimesOfTeam.reduce((prev, curr) => prev + curr);
  }

  async onCommand() {
    let teamOnePlaytime = await this.calculateHoursByTeam(1);
    let teamTwoPlaytime = await this.calculateHoursByTeam(2);

    let sumPercent = teamOnePlaytime + teamTwoPlaytime;

    if (sumPercent === 0) {
      await this.server.rcon.broadcast("Баланс сквадных неизвестен");
      return;
    }

    let percentTeamOne = ((teamOnePlaytime / sumPercent) * 100).toFixed(0);
    let percentTeamTwo = ((teamTwoPlaytime / sumPercent) * 100).toFixed(0);

    await this.server.rcon.broadcast(
      `Баланс сквадных: ${percentTeamOne}% (${teamOnePlaytime.toFixed(
        0
      )}ts) VS ${percentTeamTwo}% (${teamTwoPlaytime.toFixed(0)}ts)`
    );
  }
}
