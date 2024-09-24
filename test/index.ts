import { KmlToGeojson } from "../src/index";
import { readFileSync, writeFileSync, readdirSync } from "fs";

const kmlToGeojson = new KmlToGeojson();

const files = readdirSync("./test/input");

for (const file of files) {
    const kml = readFileSync(`./test/input/${file}`).toString();
    const result = kmlToGeojson.parse(kml);
    writeFileSync(
        `./test/output/${file.split(".")[0]}.json`,
        JSON.stringify(result, null, 2)
    );
}
