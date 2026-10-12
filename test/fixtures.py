import json

A = "4bf83995-0000-4000-8000-000000000001"
B = "4bf83995-0000-4000-8000-000000000002"
C = "4bf83995-0000-4000-8000-000000000003"
D = "11111111-2222-3333-4444-555555555555"

A_PLAYERS = [
    ("Alpha", "76561198000000101", 16401, 16746, 2),
    ("Bravo", "76561198000000102", 15674, 15951, 2),
    ("Charlie", "76561198000000103", 20118, 19999, 3),
    ("Delta", "76561198000000104", 13805, 13490, 3),
    ("Echo", "76561198000000105", 18007, 18332, 2),
    ("Foxtrot", "76561198000000106", 16318, 15956, 3),
    ("Golf", "76561198000000107", 17016, 16642, 3),
    ("Hotel India Juliett Kilo", "76561198000000108", 16348, 16712, 2),
    ("Lima Mike Nov", "76561198000000109", 16105, 16427, 2),
    ("Oscar", "76561198000000110", 18267, 17911, 3),
]

B_PLAYERS = [
    ("Golf", "76561198000000107", 16642, 16286, 3, 11, True),
    ("Fresh", "76561198000000001", 4321, 0, 3, 11, True),
    ("Stuck", "76561198000000002", 9000, 9000, 3, 11, False),
    ("Draw", "76561198000000003", 12000, 12000, 2, 11, True),
    ("Unranked", "76561198000000004", 0, 0, 2, 11, False),
    ("Low", "76561198000000005", 987, 1100, 2, 11, True),
]

C_PLAYERS = [
    ("Golf", "76561198000000107", 9, 8, 3, 12, True),
    ("Down", "76561198000000011", 5, 6, 2, 12, True),
    ("Same", "76561198000000012", 18, 18, 2, 12, True),
]


def game(match_id, players):
    mm, ps = [], []
    for i, row in enumerate(players):
        name, sid, rank, old, team = row[:5]
        rank_type = row[5] if len(row) > 5 else 11
        changed = row[6] if len(row) > 6 else True
        mm.append({"id": f"mm-{i}", "gameId": match_id, "steam64Id": sid, "gameFinishedAt": "2026-10-12T09:31:28.000Z",
                   "rank": rank, "oldRank": old, "rankType": rank_type, "rankChanged": changed, "wins": 17, "game": None})
        ps.append({"id": f"ps-{i}", "gameId": match_id, "steam64Id": sid, "name": name, "initialTeamNumber": team,
                   "totalKills": 10 + i, "totalDamage": 1987 + i})
    return {"id": match_id, "status": "ready", "dataSource": "matchmaking", "mapName": "de_mirage",
            "teamScores": [13, 1], "matchmakingGameStats": mm, "playerStats": ps, "winRateForecasts": []}


GAMES = {A: game(A, A_PLAYERS), B: game(B, B_PLAYERS), C: game(C, C_PLAYERS)}

PAGE_DATA = json.dumps({
    mid: [{"name": p["name"], "id": p["steam64Id"], "rank": m["rank"], "oldRank": m["oldRank"], "type": m["rankType"]}
          for p, m in zip(g["playerStats"], g["matchmakingGameStats"])]
    for mid, g in GAMES.items()
})
