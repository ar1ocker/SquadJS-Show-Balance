import BasePlugin from "./base-plugin.js";
import { default as PlaytimeSearcher, TIME_IS_UNKNOWN } from "./playtime-searcher.js";

const SQUAD_GAME_ID = 393380;

export default class PlaytimeBalance extends BasePlugin {
  static get description() {
    return "The playtime balance of teams";
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
    this.server.on("CHAT_COMMAND:balance", this.onCommand);
    this.server.on("CHAT_COMMAND:баланс", this.onCommand);
  }

  async calculateHoursByTeam(teamID) {
    let playtimesOfTeam = await Promise.all(
      this.server.players.map(async (player) => {
        if (player.teamID != teamID) {
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
      await this.server.rcon.broadcast("Баланс неизвестен");
      return;
    }

    let percentTeamOne = ((teamOnePlaytime / sumPercent) * 100).toFixed(0);
    let percentTeamTwo = ((teamTwoPlaytime / sumPercent) * 100).toFixed(0);

    await this.server.rcon.broadcast(
      `Баланс сторон: ${percentTeamOne}% (${teamOnePlaytime.toFixed(
        0
      )} часов) VS ${percentTeamTwo}% (${teamTwoPlaytime.toFixed(0)} часов)`
    );
    await this.server.rcon.broadcast(`Всего часов за обе команды: ${(teamOnePlaytime + teamTwoPlaytime).toFixed(0)}`);
  }
}
