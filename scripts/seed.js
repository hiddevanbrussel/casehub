const { seedIfEmpty } = require("../lib/db");

if (seedIfEmpty()) console.log("Voorbeelddata gezet.");
else console.log("Database bevat al data; seed overgeslagen.");
