LOAD CSV WITH HEADERS FROM 'file:///age1cards.csv' AS row
WITH row, CASE WHEN toInteger(row.players) IS NULL THEN row.players ELSE toInteger(row.players) END as players
MERGE (n:AgeOneCard {name: row.name, players: players})
SET n:Card,
    n.isResource = toBoolean(row.isResource),
n.color = CASE WHEN row.color = 'null' THEN null ELSE row.color END,
n.cost = CASE WHEN row.cost = 'null' THEN null ELSE row.cost END,
n.value = CASE WHEN row.value = 'null' THEN null ELSE row.value END,
n.freeFrom = CASE WHEN row.freeFrom = 'null' THEN null ELSE row.freeFrom END;
LOAD CSV WITH HEADERS FROM 'file:///age2cards.csv' AS row
WITH row, CASE WHEN toInteger(row.players) IS NULL THEN row.players ELSE toInteger(row.players) END as players
MERGE (n:AgeTwoCard {name: row.name, players: players})
SET n:Card,
    n.isResource = toBoolean(row.isResource),
n.color = CASE WHEN row.color = 'null' THEN null ELSE row.color END,
n.cost = CASE WHEN row.cost = 'null' THEN null ELSE row.cost END,
n.value = CASE WHEN row.value = 'null' THEN null ELSE row.value END,
n.freeFrom = CASE WHEN row.freeFrom = 'null' THEN null ELSE row.freeFrom END;
LOAD CSV WITH HEADERS FROM 'file:///age3cards.csv' AS row
WITH row, CASE WHEN toInteger(row.players) IS NULL THEN row.players ELSE toInteger(row.players) END as players
MERGE (n:AgeThreeCard {name: row.name, players: players})
SET n:Card,
    n.isResource = toBoolean(row.isResource),
n.color = CASE WHEN row.color = 'null' THEN null ELSE row.color END,
n.cost = CASE WHEN row.cost = 'null' THEN null ELSE row.cost END,
n.value = CASE WHEN row.value = 'null' THEN null ELSE row.value END,
n.freeFrom = CASE WHEN row.freeFrom = 'null' THEN null ELSE row.freeFrom END;
LOAD CSV WITH HEADERS FROM 'file:///wonders.csv' AS row
MERGE (w:Wonder {name: row.name})
MERGE (w)-[:HAS_SIDE]->(ws:WonderSide {side: row.side})
SET ws.resource = row.resource
WITH w, ws, row
MERGE (ws)-[:HAS_STAGE]->(stage {stage: toInteger(row.stage)})
SET stage.points = toInteger(row.points),
stage.cost = CASE WHEN row.cost = 'null' THEN null ELSE row.cost END,
stage.isResource = toBoolean(row.isResource),
stage.resource = CASE WHEN row.stageResource = 'null' THEN null ELSE row.stageResource END,
stage.science = CASE WHEN row.science = 'null' THEN null ELSE row.science END,
stage.couns = toInteger(row.coins),
stage.custom = CASE WHEN row.custom = 'null' THEN null ELSE row.custom END,
stage.military = toInteger(row.military);
