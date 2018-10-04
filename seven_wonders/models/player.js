"use strict";
const neo4j = require('neo4j-driver').v1;
const EventEmitter = require('events');

const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j','BoardGames'));

class Player extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = options.name;
    this.id = options.id || `player-${Date.now()}`;
    this.readyPromise = this.login();
    this.once('wonderOption', this.receiveWonderOption);
    this.receiveHand = this.receiveHand.bind(this);
    this.receivePlayersInfo = this.receivePlayersInfo.bind(this);
    this.on('hand', this.receiveHand);
    this.on('playersInfo', this.receivePlayersInfo);
  }

  async login() {
    let resp = await this.runQuery(this.cypherLogin());
  }

  receiveWonderOption(wonderOption) {
    this.wonderOption = wonderOption;
  }

  /**
   * Alert listeners on chosen side
   *
   * @param {object} wonderSide - information about chosen side
   * @property {string} wonderSide.wonderName - name of wonder side is for
   * @property {string} wonderSide.side - a/b, which side is chosen
   */
  chooseWonderSide(wonderSide) {
    this.emit('wonderSideChosen', this, wonderSide);
  }

  receiveHand(hand) {
    this.hand = hand;
    hand.forEach(card => this.getCombos(card));
  }

  receivePlayersInfo(playersInfo) {
    this.playersInfo = playersInfo;
  }

  playCard(card) {
    this.emit('playCard', this, card);
  }

  getCombos(card) {
    if (this.playersInfo[this.id].cardsPlayed != null && 
        this.playersInfo[this.id].cardsPlayed.map(card => card.name).indexOf(card.name) != -1) {
      card.combos = [];
      return false;
    } else if (card.isFree || (card.cost == null)) {
      card.combos = [
        {
          clockwise: {resources: [], cost: 0},
          counterClockwise: {resources: [], cost: 0},
          self: {resources: [], cost: 0}
        }
      ];
      return true;
    } else if (!isNaN(card.cost)) {
      card.combos = [
        {
          clockwise: {resources: [], cost: 0},
          counterClockwise: {resources: [], cost: 0},
          self: {resources: [], cost: parseInt(card.cost)}
        }
      ];
    } else {
      let requirements = this.resourceObject(card.cost.split(''));
      Object.keys(requirements).filter(key => key.length !== 1)
          .forEach(key => delete requirements[key]);
      let playerResources = this.getMyResources();
      requirements = this.checkResources(requirements, playerResources);
      if (Object.keys(requirements).length === 0) {
        card.combos = [
          {
            clockwise: {resources: [], cost: 0},
            counterClockwise: {resources: [], cost: 0},
            self: {resources: [], cost: 0}
          }
        ];
        return true;
      } else {
        let usableOptions = playerResources.withOptions.filter(options => options.some(opt => requirements[opt]));
        ({requirements, usableOptions} = this.checkOptionalResources(requirements, usableOptions));
        if (Object.keys(requirements).length === 0) {
          card.combos = [
            {
              clockwise: {resources: [], cost: 0},
              counterClockwise: {resources: [], cost: 0},
              self: {resources: [], cost: 0}
            }
          ];
          return true;
        } else {
          let rates = this.getRates();
          let neighborsResources = this.getNeighborsResource(requirements);
          let summaryFunction = function(resource) {
            let defaultToZero = (val) => val == null ? 0 : val;
            let optionalCount = defaultToZero(usableOptions.filter(val => val.some(r => r === resource)).length);
            let clockwiseResource = defaultToZero(neighborsResources.clockwise[resource]);
            let clockwiseOptional = defaultToZero(neighborsResources.clockwise.withOptions
                  .filter(val => val.some(r => r === resource)).length);
            let counterClockwiseResource = defaultToZero(neighborsResources.counterClockwise[resource]);
            let counterClockwiseOptional = defaultToZero(neighborsResources.counterClockwise.withOptions
                  .filter(val => val.some(r => r === resource)).length);
            let requiredCount = defaultToZero(requirements[resource]);
            return {
              resource,
              optionalCount,
              clockwiseResource,
              clockwiseOptional,
              counterClockwiseResource,
              counterClockwiseOptional,
              requiredCount,
              isRequired: optionalCount +
                  clockwiseResource +
                  clockwiseOptional +
                  counterClockwiseResource +
                  counterClockwiseOptional === requiredCount
            };
          };
          let sortMap = function(el, i, arr) {
            // if option is one of any (natural or manufactured) move to end
            if (el.length >= 3) {
              return {index: i, value: 10};
            } else {
              let summaries = el.map(summaryFunction);
              if (summaries.some(s => s.isRequired)) {
                return {index: i, value: -10};
              } else {
                let diff = summaries.map(s => s.optionalCount - s.requiredCount);
                return {index: i, value: Math.min(...diff) - Math.max(...diff)};
              }
            }
          };
          if (Object.keys(requirements)
              .map(summaryFunction)
              .some((s) => {
                return s.optionalCount +
                    s.clockwiseResource +
                    s.clockwiseOptional +
                    s.counterClockwiseResource +
                    s.counterClockwiseOptional < s.requiredCount;
              })) {
            card.combos = [];
            return false;
          }
          while (usableOptions.length > 0) {
            usableOptions = usableOptions.filter(options => options.some(opt => requirements[opt]))
                .map(sortMap)
                .sort((a,b) => a.value - b.value)
                .map(summary => usableOptions[summary.index]);
            let currentOption = usableOptions.unshift();
            let summaries = currentOption.map(summaryFunction);
            let chosenResource = this.pickValue(summaries);
            requirements[chosenResource] -= 1;
            if (requirements[chosenResource] <= 0) {
              delete requirements[chosenResource];
            }
          }
          if (Object.keys(requirements).length === 0) {
            card.combos = [
              {
                clockwise: {resources: [], cost: 0},
                counterClockwise: {resources: [], cost: 0},
                self: {resources: [], cost: 0}
              }
            ];
            return true;
          } else {
            // update neighbor resources now that options played
            neighborsResources = this.getNeighborsResource(requirements);
            let reqSummary = Object.keys(requirements).map(summaryFunction);
            if (reqSummary.some((s) => {
                return s.optionalCount +
                    s.clockwiseResource +
                    s.clockwiseOptional +
                    s.counterClockwiseResource +
                    s.counterClockwiseOptional < s.requiredCount;
              })) {
              card.combos = [];
              return false;
            }
            // TODO get array of combos for each resource into one array and reduce to affordable options
            let allCombos = reqSummary.map(req => this.costToBuy(req, rates));
            while (allCombos.length > 1) { 
              let c1 = allCombos.shift();
              let c2 = allCombos.shift();
              let newC = [];
              for (let i = 0; i < c1.length; i++){
                for (let j = 0; j < c2.length; j++){
                  newC.push({
                    self: {
                      count: c1[i].self.count + c2[j].self.count,
                      cost: c1[i].self.cost + c2[j].self.cost
                    },
                    clockwise: {
                      count: c1[i].clockwise.count + c2[j].clockwise.count,
                      cost: c1[i].clockwise.cost + c2[j].clockwise.cost
                    },
                    counterClockwise: {
                      count: c1[i].counterClockwise.count + c2[j].counterClockwise.count,
                      cost: c1[i].counterClockwise.cost + c2[j].counterClockwise.cost
                    }
                  });
                }
              }
              allCombos.unshift(newC);
            }
            card.combos = allCombos[0].filter((combo) => {
              return Object.values(combo).reduce((acc, obj) => {
                return acc + obj.cost;
              }, 0) <= this.playersInfo[this.id].coins;
            });
            return card.combos.length > 0;
          }
        }
      }
      card.combos = [];
      return false;
    }
  }
  
  /**
   * Pick best optional resource based on summaries and rates
   * @param {Object[]} summaries - summary information about options
   * @param {string} summaries[].resource - resource option is for
   * @param {int} summaries[].optionalCount - count player can use of resource
   * @param {int} summaries[].clockwiseResource - count player can buy
   *     from clockwise player without other optional use
   * @param {int} summaries[].clockwiseOptional - count player can buy
   *     from clockwise player that have other optional use
   * @param {int} summaries[].counterClockwiseResource
   * @param {int} summaries[].counterClockwiseOptional
   * @param {int} summaries[].requiredCount - number of that resource required
   * @param {boolean} summaries[].isRequired - whether optional resource is
   *     required to meet requirements
   */
  pickValue(summaries, rates) {
    let bestOption = 0;
    for (i = 0; i < summaries.length; i++) {
      let currentBest = summaries[bestOption];
      if (summaries[i].isRequired) {
        return summaries[i].resource;
      }
      if (summaries[i].optionalCount <= summaries[i].requiredCount) {
        if (currentBest.optionalCount > currentBest.requiredCount) {
          bestOption = i;
        } else {
          const reducer = (acc, val) => acc + val.cost;
          const aveSavings = (costs, optionalCount) => {
            return (Math.min(...costs.filter(cost => !cost.usesOptional)) - 
                Math.min(...costs.filter(cost => cost.usesOptional))) / optionalCount;
          };
          let bestCosts = this.costToBuy(currentBest, rates).map((combo) => {
            return {
              totalCost: Object.values(combo).reduce(reducer, 0),
              usesOptional: combo.self.count > 0
            };
          });
          let currentCosts = this.costToBuy(summaries[i], rates).map((combo) => {
            return {
              totalCost: Object.values(combo).reduce(reducer, 0),
              usesOptional: combo.self.count > 0
            };
          });
          let bestSavings = aveSavings(bestCosts);
          let currentSavings = aveSavings(currentCosts);
          if (currentSavings > bestSavings) {
            bestOption = i;
          } else if (currentSavings === bestSavings &&
              (summaries[i].clockwiseResource +
              summaries[i].counterClockwiseResource <
              summaries[i].requiredCount)) {
              bestOption = i;
          }
        }
      } else if (currentBest.optionalCount > currentBest.requiredCount) {
        const reducer = (acc, val) => acc + val.cost;
        const aveSavings = (costs, optionalCount) => {
          return (Math.min(...costs.filter(cost => !cost.usesOptional)) - 
              Math.min(...costs.filter(cost => cost.usesOptional))) / optionalCount;
        };
        let bestCosts = this.costToBuy(currentBest, rates).map((combo) => {
          return {
            totalCost: Object.values(combo).reduce(reducer, 0),
            usesOptional: combo.self.count > 0
          };
        });
        let currentCosts = this.costToBuy(summaries[i], rates).map((combo) => {
          return {
            totalCost: Object.values(combo).reduce(reducer, 0),
            usesOptional: combo.self.count > 0
          };
        });
        let bestSavings = aveSavings(bestCosts);
        let currentSavings = aveSavings(currentCosts);
        if (currentSavings > bestSavings) {
          bestOption = i;
        } else if (currentSavings === bestSavings &&
            (summaries[i].clockwiseResource +
            summaries[i].counterClockwiseResource <
            summaries[i].requiredCount)) {
            bestOption = i;
        }
      }
    }
    return summaries[bestOption].resource;
  }

  /**
   * Pick best optional resource based on summaries and rates
   * @param {Object[]} summaries - summary information about options
   * @param {string} summary.resource - resource option is for
   * @param {int} summary.optionalCount - count player can use of resource
   * @param {int} summary.clockwiseResource - count player can buy
   *     from clockwise player without other optional use
   * @param {int} summary.clockwiseOptional - count player can buy
   *     from clockwise player that have other optional use
   * @param {int} summary.counterClockwiseResource
   * @param {int} summary.counterClockwiseOptional
   * @param {int} summary.requiredCount - number of that resource required
   * @param {boolean} summary.isRequired - whether optional resource is
   *     required to meet requirements
   */
  costToBuy(summary, rates) {
    let combos = [];
    let maxClockwise = summary.clockwiseResource + summary.clockwiseOptional;
    let maxCounterClockwise = summary.counterClockwiseResource + 
        summary.counterClockwiseOptional;
    if (summary.optionalCount > 0) {
      let requiredCount = summary.requiredCount - summary.optionalCount;
      if (maxClockwise >= requiredCount) {
        combos.push({
          clockwise: {
            count: requiredCount,
            cost: requiredCount * rates.clockwise[summary.resource]
          },
          self: {count: 0, cost: 0},
          counterClockwise: {count: 0, cost: 0}
        });
      } else if (maxClockwise + maxCounterClockwise >= requiredCount) {
        combos.push({
          clockwise: {
            count: maxClockwise,
            cost: maxClockwise * rates.clockwise[summary.resource]
          },
          self: {count: 0, cost: 0},
          counterClockwise: {
            count: requiredCount - maxClockwise,
            cost: (requiredCount - maxClockwise) *
                rates.counterClockwise[summary.resource]
          }
        });
      }
      if (maxCounterClockwise >= requiredCount) {
        combos.push({
          clockwise: {count: 0, cost: 0},
          self: {count: 0, cost: 0},
          counterClockwise: {
            count: requiredCount,
            cost: requiredCount *
                rates.counterClockwise[summary.resource]
          }
        });
      } else if (maxClockwise + maxCounterClockwise >= requiredCount) {
        combos.push({
          clockwise: {
            count: requiredCount - maxCounterClockwise,
            cost: (requiredCount - maxCounterClockwise) *
                rates.clockwise[summary.resource]
          },
          self: {count: 0, cost: 0},
          counterClockwise: {
            count: maxCounterClockwise,
            cost: maxCounterClockwise * rates.counterClockwise[summary.resource]
          }
        });
      }
    }
    for (let i = 0; i <= maxClockwise && i <= summary.requiredCount; i++) {
      if (i + maxCounterClockwise >= summary.requiredCount) {
        combos.push({
          clockwise: {
            count: i,
            cost: i * rates.clockwise[summary.resource]
          },
          self: {count: 0, cost: 0},
          counterClockwise: {
            count: summary.requiredCount - i,
            cost: (summary.requiredCount - i) *
                rates.counterClockwise[summary.resource]
          }
        });
      }
    }
    return combos;
  }

  getRates() {
    let cardsPlayed = this.playersInfo[this.id].cardsPlayed || [];
    let clockwiseNatural = cardsPlayed.some(card => card.name === 'West Trading Post');
    let counterNatural = cardsPlayed.some(card => card.name === 'East Trading Post');
    let allNatural = this.playersInfo[this.id].wonderName === 'olympia' &&
        this.playersInfo[this.id].stagesInfo.some((stage) => {
          return stage.isBuilt && stage.custom === 'discount';
        });
    let clockwiseRate = clockwiseNatural || allNatural ? 1 : 2;
    let counterClockwiseRate = counterNatural || allNatural ? 1 : 2;
    let manufactureRate = cardsPlayed.some(card => card.name === 'Marketplace') ?
        1 : 2;
    return {
      clockwise: {
        C: clockwiseRate,
        S: clockwiseRate,
        O: clockwiseRate,
        W: clockwiseRate,
        L: manufactureRate,
        G: manufactureRate,
        P: manufactureRate
      },
      counterClockwise: {
        C: counterClockwiseRate,
        S: counterClockwiseRate,
        O: counterClockwiseRate,
        W: counterClockwiseRate,
        L: manufactureRate,
        G: manufactureRate,
        P: manufactureRate
      }
    };
  }

  checkResources(requirements, resourceObject) {
    requirements = {...requirements};
    Object.keys(requirements).forEach(function(key) {
      if (resourceObject[key]) {
        requirements[key] -= resourceObject[key];
        if (requirements[key] <= 0) {
          delete requirements[key];
        }
      }
    });
    return requirements;
  }
  
  /**
   * @returns {Object} requirements, usedOptions, usedIndices, usableOptions
   **/
  checkOptionalResources(requirements, usableOptions) {
    usableOptions = [...usableOptions];
    requirements = {...requirements};
    let continueChecking = usableOptions.length > 0;
    let usedOptions = [];
    while (continueChecking) {
      let usedIndices = [];
      continueChecking = false;
      for (let i = 0; i < usableOptions.length; i++) {
        let potentialResources = [];
        for (let j = 0; j < usableOptions[i].length; j++) {
          if (requirements[usableOptions[i][j]]) {
            potentialResources.push(usableOptions[i][j]);
          }
        }
        if (potentialResources.length === 1) {
          usedOptions.push(potentialResources[0]);
          usedIndices.push(i);
          requirements[potentialResources[0]] -= 1;
          if (requirements[potentialResources[0]] <= 0) {
            delete requirements[potentialResources[0]];
          }
          continueChecking = true;
        }
      }
      for (let i = usedIndices.length - 1; i >= 0; i--) {
        usableOptions.splice(usedIndices[i], 1);
      }
    }
    return {
      requirements,
      usedOptions,
      usableOptions
    };
  }

  resourceObject(resourceArray = []) {
    let resources = {withOptions: []};
    let ensureKey = (object, key) => object[key] = 0;
    resourceArray.forEach((resource) => {
      if (resource.includes('/')) {
        resources.withOptions.push(resource.split('/'));
      } else {
        ensureKey(resources, resource[0]);
        resources[resource[0]] += resource.length;
      }
    });
    return resources;
  }

  // return resources availble for player to use
  getMyResources() {
    let playerInfo = this.playersInfo[this.id];
    let resources = [];
    resources.push(playerInfo.wonderResource);
    resources.push(...playerInfo.stagesInfo
                        .filter(stage => stage.isBuilt && stage.isResource)
                        .map(stage => stage.resource));
    if (playerInfo.cardsPlayed != null) {
      resources.push(...playerInfo.cardsPlayed.filter(card => card.isResource).map(card => card.value));
    }
    return this.resourceObject(resources);
  }

  getNeighborsResource(requirements) {
    let neighbors = {
      clockwise: this.getNeighborResource(this.playersInfo[this.id].clockwisePlayer, {...requirements}),
      counterClockwise: this.getNeighborResource(this.playersInfo[this.id].counterClockwisePlayer, {...requirements})
    };
    return neighbors;
  }

  getNeighborResource(playerId, requirements) {
    let playerInfo = this.playersInfo[playerId];
    let resources = [];
    resources.push(playerInfo.wonderResource);
    if (playerInfo.cardsPlayed != null) {
      resources.push(...playerInfo.cardsPlayed.filter(card => card.isResource && ['brown', 'grey'].indexOf(card.color) > -1)
                                              .map(card => card.value));
    }
    let resourceObject = this.resourceObject(resources);
    requirements = this.checkResources(requirements, resourceObject);
    let optionalUse = this.checkOptionalResources(requirements, resourceObject.withOptions);
    requirements = optionalUse.requirements;
    resourceObject.withOptions = optionalUse.usableOptions
      .filter(options => options.some(opt => requirements[opt]));
    optionalUse.usedOptions.forEach(function(resource) {
      if (resourceObject[resource] == null) {
        resourceObject[resource] = 1;
      } else {
        resourceObject[resource] += 1;
      }
    });
    return resourceObject;
  }

  discard(card) {
    this.emit('discard', this, card);
  }

  buildWonder(card) {
    this.emit('buildWonder', this, card);
  }

  // connect to database and run query
  // cypher is object with query and params
  // closes session and returns resp
  async runQuery(cypher) {
    if (cypher.query) {
      let params = cypher.params || {playerId: this.id, playerName: this.name};
      let session = driver.session();
      try {
        let resp = await session.run(cypher.query, params);
        session.close();
        return resp;
       } catch (error) {
          this.emit('error', error);
       };
    } else {
      this.emit('error', new Error('query not included with cypher object'));
    }
  }

  cypherLogin() {
    let query = `
      // Ensure player exists
      MERGE (p:Player {playerId: $playerId})
      SET p.name = $playerName
    `;
    return {query: query};
  }
}

module.exports = Player;