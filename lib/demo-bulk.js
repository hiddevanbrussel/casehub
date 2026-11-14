// Large scale demo: one case with thousands of neighbours, used to show how
// the system handles mass notification and batched document generation.
const BULK_KEY = "stadion-heien";
const BULK_COUNT = 10000;
const HOUSES_PER_STREET = 125;
const ADDITIONS = ["", "A", "B", "C"];

const packs = {
  nl: {
    land: "Nederland",
    plaats: "Eindhoven",
    titel: "Melding heiwerkzaamheden nieuw stadion",
    omschrijving:
      "Melding van heiwerkzaamheden voor de bouw van het nieuwe stadion aan de Stadionboulevard. Alle omwonenden binnen de geluidscontour worden per brief geïnformeerd over de planning, de werktijden en het meldpunt voor schade aan woningen.",
    referentie: "ML-2026-900",
    caseTypeName: "Melding",
    emailDomein: "omwonenden.example.nl",
    streets: [
      ["Stadionboulevard", "5611"],
      ["Heiveldstraat", "5612"],
      ["Tribunelaan", "5613"],
      ["Scheidsrechterspad", "5614"],
      ["Middenstip", "5615"],
      ["Doelmanstraat", "5616"],
      ["Kleedkamerweg", "5617"],
      ["Supportersplein", "5621"],
      ["Grasmatsingel", "5622"],
      ["Hoekschopstraat", "5623"],
      ["Spandoeklaan", "5624"],
      ["Fluitsignaalhof", "5625"],
      ["Aftrapweg", "5626"],
      ["Vrijeschopstraat", "5627"],
      ["Strafschopkade", "5628"],
      ["Rodekaartlaan", "5629"],
      ["Blessuretijdhof", "5631"],
      ["Verlengingstraat", "5632"],
      ["Keeperspad", "5633"],
      ["Eretribuneweg", "5634"],
    ],
    firstNames: [
      ["Daan", "man"], ["Sem", "man"], ["Lucas", "man"], ["Finn", "man"], ["Jesse", "man"],
      ["Bram", "man"], ["Noud", "man"], ["Thijs", "man"], ["Teun", "man"], ["Gijs", "man"],
      ["Pieter", "man"], ["Hendrik", "man"], ["Willem", "man"], ["Joris", "man"], ["Maarten", "man"],
      ["Bas", "man"], ["Ruben", "man"], ["Koen", "man"], ["Stijn", "man"], ["Jeroen", "man"],
      ["Emma", "vrouw"], ["Julia", "vrouw"], ["Sophie", "vrouw"], ["Anna", "vrouw"], ["Lotte", "vrouw"],
      ["Fleur", "vrouw"], ["Saar", "vrouw"], ["Eva", "vrouw"], ["Noor", "vrouw"], ["Lieke", "vrouw"],
      ["Marieke", "vrouw"], ["Hanneke", "vrouw"], ["Willemijn", "vrouw"], ["Sanne", "vrouw"], ["Ingrid", "vrouw"],
      ["Petra", "vrouw"], ["Carla", "vrouw"], ["Renske", "vrouw"], ["Maaike", "vrouw"], ["Esther", "vrouw"],
    ],
    lastNames: [
      ["", "Jansen"], ["", "Bakker"], ["de", "Vries"], ["van", "Dijk"], ["", "Visser"],
      ["van", "Leeuwen"], ["", "Smit"], ["", "Meijer"], ["de", "Boer"], ["van", "Dam"],
      ["", "Mulder"], ["", "Bos"], ["de", "Groot"], ["van", "Beek"], ["", "Peters"],
      ["", "Hendriks"], ["van", "Vliet"], ["", "Kuipers"], ["", "Verhoeven"], ["van", "der Berg"],
      ["", "Koning"], ["", "Timmermans"], ["de", "Wit"], ["van", "Doorn"], ["", "Willems"],
      ["", "Brouwer"], ["", "Postma"], ["van", "Rijn"], ["", "Dekker"], ["", "Schouten"],
    ],
  },
  en: {
    land: "United Kingdom",
    plaats: "Manchester",
    titel: "Notification of piling work for the new stadium",
    omschrijving:
      "Notification of piling work for the construction of the new stadium on Stadium Boulevard. Every resident within the noise contour receives a letter about the schedule, the working hours and where to report damage to their home.",
    referentie: "ML-2026-900",
    caseTypeName: "Notification",
    emailDomein: "residents.example.co.uk",
    streets: [
      ["Stadium Boulevard", "M11"], ["Piling Street", "M12"], ["Stand Lane", "M13"], ["Referee Walk", "M14"],
      ["Centre Circle", "M15"], ["Goalkeeper Road", "M16"], ["Dressing Room Way", "M17"], ["Supporters Square", "M18"],
      ["Turf Avenue", "M19"], ["Corner Kick Street", "M20"], ["Banner Lane", "M21"], ["Whistle Court", "M22"],
      ["Kick Off Road", "M23"], ["Free Kick Street", "M24"], ["Penalty Quay", "M25"], ["Red Card Lane", "M26"],
      ["Injury Time Court", "M27"], ["Extra Time Street", "M28"], ["Keepers Path", "M29"], ["Main Stand Way", "M30"],
    ],
    firstNames: [
      ["Oliver", "man"], ["Harry", "man"], ["Jack", "man"], ["George", "man"], ["Noah", "man"],
      ["Leo", "man"], ["Arthur", "man"], ["Oscar", "man"], ["Charlie", "man"], ["Henry", "man"],
      ["William", "man"], ["James", "man"], ["Thomas", "man"], ["Edward", "man"], ["Alfie", "man"],
      ["Freddie", "man"], ["Samuel", "man"], ["Daniel", "man"], ["Joseph", "man"], ["Michael", "man"],
      ["Olivia", "vrouw"], ["Amelia", "vrouw"], ["Isla", "vrouw"], ["Ava", "vrouw"], ["Mia", "vrouw"],
      ["Grace", "vrouw"], ["Freya", "vrouw"], ["Poppy", "vrouw"], ["Emily", "vrouw"], ["Charlotte", "vrouw"],
      ["Sophie", "vrouw"], ["Hannah", "vrouw"], ["Alice", "vrouw"], ["Rosie", "vrouw"], ["Eleanor", "vrouw"],
      ["Jessica", "vrouw"], ["Megan", "vrouw"], ["Louise", "vrouw"], ["Claire", "vrouw"], ["Rebecca", "vrouw"],
    ],
    lastNames: [
      ["", "Smith"], ["", "Jones"], ["", "Taylor"], ["", "Brown"], ["", "Wilson"],
      ["", "Evans"], ["", "Thomas"], ["", "Johnson"], ["", "Roberts"], ["", "Walker"],
      ["", "Wright"], ["", "Robinson"], ["", "Thompson"], ["", "White"], ["", "Hughes"],
      ["", "Edwards"], ["", "Green"], ["", "Hall"], ["", "Wood"], ["", "Harris"],
      ["", "Clarke"], ["", "Jackson"], ["", "Turner"], ["", "Hill"], ["", "Cooper"],
      ["", "Ward"], ["", "Morris"], ["", "Moore"], ["", "Baker"], ["", "Bell"],
    ],
  },
  de: {
    land: "Deutschland",
    plaats: "Dortmund",
    titel: "Meldung Rammarbeiten für das neue Stadion",
    omschrijving:
      "Meldung über Rammarbeiten für den Bau des neuen Stadions am Stadionboulevard. Alle Anwohner innerhalb der Lärmkontur erhalten einen Brief über den Zeitplan, die Arbeitszeiten und die Meldestelle für Gebäudeschäden.",
    referentie: "ML-2026-900",
    caseTypeName: "Meldung",
    emailDomein: "anwohner.example.de",
    streets: [
      ["Stadionboulevard", "4411"], ["Rammpfahlstraße", "4412"], ["Tribünenweg", "4413"], ["Schiedsrichterpfad", "4414"],
      ["Mittelkreis", "4415"], ["Torwartstraße", "4416"], ["Kabinenweg", "4417"], ["Fanplatz", "4418"],
      ["Rasenallee", "4419"], ["Eckstoßstraße", "4421"], ["Spruchbandweg", "4422"], ["Pfiffhof", "4423"],
      ["Anstoßweg", "4424"], ["Freistoßstraße", "4425"], ["Elfmeterkai", "4426"], ["Rotekarteweg", "4427"],
      ["Nachspielzeithof", "4428"], ["Verlängerungstraße", "4429"], ["Keeperpfad", "4431"], ["Haupttribünenweg", "4432"],
    ],
    firstNames: [
      ["Lukas", "man"], ["Leon", "man"], ["Paul", "man"], ["Jonas", "man"], ["Felix", "man"],
      ["Maximilian", "man"], ["Elias", "man"], ["Noah", "man"], ["Ben", "man"], ["Moritz", "man"],
      ["Johannes", "man"], ["Andreas", "man"], ["Stefan", "man"], ["Thomas", "man"], ["Matthias", "man"],
      ["Sebastian", "man"], ["Florian", "man"], ["Tobias", "man"], ["Jan", "man"], ["Michael", "man"],
      ["Emma", "vrouw"], ["Hannah", "vrouw"], ["Mia", "vrouw"], ["Sofia", "vrouw"], ["Lina", "vrouw"],
      ["Clara", "vrouw"], ["Leonie", "vrouw"], ["Marie", "vrouw"], ["Johanna", "vrouw"], ["Lena", "vrouw"],
      ["Sabine", "vrouw"], ["Katharina", "vrouw"], ["Christina", "vrouw"], ["Julia", "vrouw"], ["Anja", "vrouw"],
      ["Petra", "vrouw"], ["Nicole", "vrouw"], ["Franziska", "vrouw"], ["Birgit", "vrouw"], ["Claudia", "vrouw"],
    ],
    lastNames: [
      ["", "Müller"], ["", "Schmidt"], ["", "Schneider"], ["", "Fischer"], ["", "Weber"],
      ["", "Meyer"], ["", "Wagner"], ["", "Becker"], ["", "Schulz"], ["", "Hoffmann"],
      ["", "Schäfer"], ["", "Koch"], ["", "Bauer"], ["", "Richter"], ["", "Klein"],
      ["", "Wolf"], ["", "Neumann"], ["", "Schwarz"], ["", "Zimmermann"], ["", "Braun"],
      ["", "Krüger"], ["", "Hofmann"], ["", "Hartmann"], ["", "Lange"], ["", "Werner"],
      ["", "Schmitt"], ["", "Krause"], ["", "Meier"], ["", "Lehmann"], ["", "Köhler"],
    ],
  },
};

function slug(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "");
}

function postcodeOf(pack, prefix, index) {
  if (pack.plaats === "Manchester") return `${prefix} ${index % 9}${"ABDEFGHJLNPQRSTUWXYZ"[index % 20]}${"ABDEFGHJLNPQRSTUWXYZ"[(index * 7) % 20]}`;
  if (pack.land === "Deutschland") return `${prefix}${index % 10}`;
  return `${prefix} ${"ABCDEFGHJKLMNPRSTVWXYZ"[index % 22]}${"ABCDEFGHJKLMNPRSTVWXYZ"[(index * 5) % 22]}`;
}

function bulkPack(lang) {
  return packs[lang] || packs.en;
}

// Deterministic residents: same input always produces the same neighbourhood.
function bulkPersons(lang, count = BULK_COUNT) {
  const pack = bulkPack(lang);
  const list = [];
  for (let i = 0; i < count; i += 1) {
    const [voornaam, geslacht] = pack.firstNames[i % pack.firstNames.length];
    const [tussenvoegsel, achternaam] = pack.lastNames[Math.floor(i / pack.firstNames.length) % pack.lastNames.length];
    const [straat, postcodePrefix] = pack.streets[Math.floor(i / (HOUSES_PER_STREET * ADDITIONS.length)) % pack.streets.length];
    const withinStreet = i % (HOUSES_PER_STREET * ADDITIONS.length);
    const huisnummer = `${Math.floor(withinStreet / ADDITIONS.length) + 1}${ADDITIONS[withinStreet % ADDITIONS.length]}`;
    const jaar = 1945 + (i % 60);
    const maand = String((i % 12) + 1).padStart(2, "0");
    const dag = String((i % 28) + 1).padStart(2, "0");
    list.push({
      voornaam,
      tussenvoegsel,
      achternaam,
      geslacht,
      email: `${slug(voornaam)}.${slug(achternaam)}${i + 1}@${pack.emailDomein}`,
      telefoon: `06 ${String(10000000 + i).slice(0, 4)} ${String(10000000 + i).slice(4)}`,
      straat,
      huisnummer,
      adres: `${straat} ${huisnummer}`,
      postcode: postcodeOf(pack, postcodePrefix, i),
      plaats: pack.plaats,
      land: pack.land,
      geboortedatum: `${jaar}-${maand}-${dag}`,
    });
  }
  return list;
}

module.exports = { BULK_KEY, BULK_COUNT, bulkPack, bulkPersons };
