# Game presentation data

`zones.json` maps zone identifiers to display names for classic, Kunark, and
Velious zones. Names and identifiers were checked against nParse's
[`map_keys.ini`](https://github.com/nomns/nparse/blob/master/data/maps/map_keys.ini)
and [`map_keys_who.ini`](https://github.com/nomns/nparse/blob/master/data/maps/map_keys_who.ini).
The latter supplies familiar names such as Lower Guk and Plane of Sky. Unknown
zone identifiers remain visible as received. `eastcommons` and `westcommons`
are aliases for the Commonlands zones.

Channel colors in `App.css` use the Titanium client's TextColors palette,
checked against both the installed client's INI settings and embedded RGB table.
The bundled EQ manual documents User_1 through User_8 and User_18;
[EQEmu's chat constants](https://github.com/EQEmu/EQEmu/blob/master/common/eq_constants.h)
also identify item links and raid chat. User color indices equal the chat color
constant minus 255.

| Channel       | User color | RGB hex |
| ------------- | ---------- | ------- |
| Say / default | 1 / 18     | #FFFFFF |
| Tell          | 2          | #BE28BE |
| Group         | 3          | #00FFFF |
| Guild         | 4          | #28F028 |
| OOC           | 5          | #008000 |
| Auction       | 6          | #008000 |
| Shout         | 7          | #FF0000 |
| Emote         | 8          | #5A5AFF |
| Item links    | 71         | #FF00FF |
| Raid          | 72         | #00C8C8 |
