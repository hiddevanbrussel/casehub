const packs = {
  en: {
    companies: [
      { key: "council", handelsnaam: "Riverside Borough Council", kvk: "01234567", adres: "Civic Centre, 1 High Street", postcode: "SW1A 2AA", plaats: "London", email: "info@riverside-council.example.co.uk", telefoon: "020 7946 0001", notities: "Local authority sample record." },
      { key: "builder", handelsnaam: "Oakridge Construction Ltd", kvk: "09876543", adres: "44 Industrial Way", postcode: "M1 2AB", plaats: "Manchester", email: "office@oakridge.example.co.uk", telefoon: "0161 496 0100", notities: "Building contractor." },
      { key: "legal", handelsnaam: "Hartley & Co Solicitors", kvk: "11223344", adres: "8 Chambers Row", postcode: "EH1 1YZ", plaats: "Edinburgh", email: "mail@hartley.example.co.uk", telefoon: "0131 496 0200", notities: "Legal practice." },
      { key: "housing", handelsnaam: "Northgate Housing Association", kvk: "55667788", adres: "20 Canal Street", postcode: "B1 1AA", plaats: "Birmingham", email: "hello@northgate.example.co.uk", telefoon: "0121 496 0300", notities: "Social housing provider." },
      { key: "energy", handelsnaam: "Greenfield Energy plc", kvk: "33445566", adres: "3 Quayside", postcode: "NE1 3DX", plaats: "Newcastle", email: "contact@greenfield.example.co.uk", telefoon: "0191 496 0400", notities: "Energy supplier." },
      { key: "clinic", handelsnaam: "Maple Health Practice", kvk: "77889900", adres: "15 Church Lane", postcode: "BS1 4DJ", plaats: "Bristol", email: "reception@maple.example.co.uk", telefoon: "0117 496 0500", notities: "GP practice." },
    ],
    persons: [
      { voornaam: "James", achternaam: "Whitfield", email: "james.whitfield@example.co.uk", telefoon: "07700 900001", adres: "12 Victoria Road", postcode: "SW1A 1AA", plaats: "London", geboortedatum: "1978-04-12", bsn: "111222333", companyKey: "" },
      { voornaam: "Emily", achternaam: "Carter", email: "emily.carter@oakridge.example.co.uk", telefoon: "07700 900002", adres: "8 King Street", postcode: "M2 4WU", plaats: "Manchester", geboortedatum: "1991-09-03", bsn: "222333444", companyKey: "builder" },
      { voornaam: "Oliver", achternaam: "Bennett", email: "oliver.bennett@example.co.uk", telefoon: "07700 900003", adres: "4 Princes Street", postcode: "EH2 2AN", plaats: "Edinburgh", geboortedatum: "1985-01-22", bsn: "333444555", companyKey: "legal" },
      { voornaam: "Sophie", achternaam: "Hughes", email: "sophie.hughes@northgate.example.co.uk", telefoon: "07700 900004", adres: "19 Broad Street", postcode: "B1 2HP", plaats: "Birmingham", geboortedatum: "1994-06-18", bsn: "444555666", companyKey: "housing" },
      { voornaam: "Daniel", achternaam: "Patel", email: "daniel.patel@greenfield.example.co.uk", telefoon: "07700 900005", adres: "7 Grey Street", postcode: "NE1 6AE", plaats: "Newcastle", geboortedatum: "1982-11-09", bsn: "555666777", companyKey: "energy" },
      { voornaam: "Chloe", achternaam: "Murray", email: "chloe.murray@example.co.uk", telefoon: "07700 900006", adres: "22 Park Row", postcode: "BS1 5LX", plaats: "Bristol", geboortedatum: "1997-02-27", bsn: "666777888", companyKey: "clinic" },
      { voornaam: "Thomas", achternaam: "Walsh", email: "thomas.walsh@riverside-council.example.co.uk", telefoon: "07700 900007", adres: "3 Queen’s Walk", postcode: "SW1A 2HB", plaats: "London", geboortedatum: "1969-08-14", bsn: "777888999", companyKey: "council" },
      { voornaam: "Amelia", achternaam: "Wright", email: "amelia.wright@example.co.uk", telefoon: "07700 900008", adres: "11 Station Road", postcode: "M1 1AE", plaats: "Manchester", geboortedatum: "1988-12-01", bsn: "888999000", companyKey: "" },
    ],
  },
  nl: {
    companies: [
      { key: "council", handelsnaam: "Gemeente Rivierenland", kvk: "12345678", adres: "Raadhuisplein 1", postcode: "4001 AA", plaats: "Tiel", email: "info@rivierenland.example.nl", telefoon: "0344 123 456", notities: "Voorbeeldgemeente." },
      { key: "builder", handelsnaam: "Bouwbedrijf De Linden B.V.", kvk: "87654321", adres: "Industrieweg 44", postcode: "4004 CD", plaats: "Tiel", email: "kantoor@delinden.example.nl", telefoon: "0344 765 432", notities: "Aannemer." },
      { key: "legal", handelsnaam: "Notariskantoor Van Dijk", kvk: "11223344", adres: "Kerkstraat 8", postcode: "3511 AB", plaats: "Utrecht", email: "info@vandijk.example.nl", telefoon: "030 123 4567", notities: "Notariaat." },
      { key: "housing", handelsnaam: "Woningstichting De Brink", kvk: "55667788", adres: "Markt 12", postcode: "6811 CG", plaats: "Arnhem", email: "info@debrink.example.nl", telefoon: "026 123 4567", notities: "Woningcorporatie." },
      { key: "energy", handelsnaam: "Stroomdal Energie", kvk: "33445566", adres: "Nieuwehaven 3", postcode: "3011 AA", plaats: "Rotterdam", email: "contact@stroomdal.example.nl", telefoon: "010 123 4567", notities: "Energieleverancier." },
      { key: "clinic", handelsnaam: "Huisartsenpraktijk De Markt", kvk: "77889900", adres: "Brinklaan 15", postcode: "1404 GA", plaats: "Bussum", email: "balie@demarkt.example.nl", telefoon: "035 123 4567", notities: "Huisartsenpraktijk." },
    ],
    persons: [
      { voornaam: "Jan", tussenvoegsel: "de", achternaam: "Vries", geslacht: "man", email: "jan.devries@example.nl", telefoon: "06 1234 5678", adres: "Brinklaan 12", postcode: "1404 GB", plaats: "Bussum", geboortedatum: "1978-04-12", bsn: "111222333", companyKey: "" },
      { voornaam: "Marieke", achternaam: "Bakker", geslacht: "vrouw", email: "m.bakker@delinden.example.nl", telefoon: "06 8765 4321", adres: "Kerkstraat 8", postcode: "4001 AB", plaats: "Tiel", geboortedatum: "1991-09-03", bsn: "222333444", companyKey: "builder" },
      { voornaam: "Pieter", achternaam: "Jansen", geslacht: "man", email: "pieter.jansen@vandijk.example.nl", telefoon: "06 1122 3344", adres: "Oudegracht 40", postcode: "3511 AD", plaats: "Utrecht", geboortedatum: "1985-01-22", bsn: "333444555", companyKey: "legal" },
      { voornaam: "Sophie", tussenvoegsel: "de", achternaam: "Jong", geslacht: "vrouw", email: "sophie.dejong@debrink.example.nl", telefoon: "06 5566 7788", adres: "Rijnstraat 19", postcode: "6811 HL", plaats: "Arnhem", geboortedatum: "1994-06-18", bsn: "444555666", companyKey: "housing" },
      { voornaam: "Ahmed", achternaam: "El Amrani", email: "ahmed.elamrani@stroomdal.example.nl", telefoon: "06 3344 5566", adres: "Witte de Withstraat 7", postcode: "3012 BK", plaats: "Rotterdam", geboortedatum: "1982-11-09", bsn: "555666777", companyKey: "energy" },
      { voornaam: "Lisa", achternaam: "Visser", email: "lisa.visser@example.nl", telefoon: "06 7788 9900", adres: "Naarderstraat 22", postcode: "1404 CE", plaats: "Bussum", geboortedatum: "1997-02-27", bsn: "666777888", companyKey: "clinic" },
      { voornaam: "Willem", achternaam: "Hendriks", email: "w.hendriks@rivierenland.example.nl", telefoon: "06 1010 2020", adres: "Burgemeesterslaan 3", postcode: "4001 AC", plaats: "Tiel", geboortedatum: "1969-08-14", bsn: "777888999", companyKey: "council" },
      { voornaam: "Fatima", achternaam: "Benali", email: "fatima.benali@example.nl", telefoon: "06 9090 8080", adres: "Stationsweg 11", postcode: "3511 CB", plaats: "Utrecht", geboortedatum: "1988-12-01", bsn: "888999000", companyKey: "" },
    ],
  },
  da: {
    companies: [
      { key: "council", handelsnaam: "Eksempel Kommune", kvk: "29123456", adres: "Rådhuspladsen 1", postcode: "1550", plaats: "København", email: "info@eksempel.example.dk", telefoon: "33 12 34 56", notities: "Eksempelkommune." },
      { key: "builder", handelsnaam: "Byggefirma Lind & Søn A/S", kvk: "29876543", adres: "Industrivej 44", postcode: "8000", plaats: "Aarhus", email: "kontor@lindson.example.dk", telefoon: "86 12 34 56", notities: "Entreprenør." },
      { key: "legal", handelsnaam: "Advokatfirmaet Holm", kvk: "29112233", adres: "Nørregade 8", postcode: "1165", plaats: "København", email: "mail@holm.example.dk", telefoon: "33 22 11 00", notities: "Advokatkontor." },
      { key: "housing", handelsnaam: "Boligselskabet Østerbro", kvk: "29556677", adres: "Østerbrogade 20", postcode: "2100", plaats: "København", email: "info@osterbro.example.dk", telefoon: "35 12 34 56", notities: "Almen boligorganisation." },
      { key: "energy", handelsnaam: "Nordlys Energi A/S", kvk: "29334455", adres: "Havnegade 3", postcode: "5000", plaats: "Odense", email: "kontakt@nordlys.example.dk", telefoon: "66 12 34 56", notities: "Elselskab." },
      { key: "clinic", handelsnaam: "Lægehuset Sankt Hans", kvk: "29778899", adres: "Sankt Hans Gade 15", postcode: "2200", plaats: "København", email: "reception@sankthans.example.dk", telefoon: "35 22 33 44", notities: "Lægepraksis." },
    ],
    persons: [
      { voornaam: "Lars", achternaam: "Jensen", email: "lars.jensen@example.dk", telefoon: "20 12 34 56", adres: "Nørrebrogade 12", postcode: "2200", plaats: "København", geboortedatum: "1978-04-12", bsn: "1204781111", companyKey: "" },
      { voornaam: "Mette", achternaam: "Nielsen", email: "mette.nielsen@lindson.example.dk", telefoon: "21 23 45 67", adres: "Vestergade 8", postcode: "8000", plaats: "Aarhus", geboortedatum: "1991-09-03", bsn: "0309912222", companyKey: "builder" },
      { voornaam: "Anders", achternaam: "Hansen", email: "anders.hansen@holm.example.dk", telefoon: "22 34 56 78", adres: "Købmagergade 40", postcode: "1150", plaats: "København", geboortedatum: "1985-01-22", bsn: "2201853333", companyKey: "legal" },
      { voornaam: "Sofie", achternaam: "Pedersen", email: "sofie.pedersen@osterbro.example.dk", telefoon: "23 45 67 89", adres: "Øster Farimagsgade 19", postcode: "2100", plaats: "København", geboortedatum: "1994-06-18", bsn: "1806944444", companyKey: "housing" },
      { voornaam: "Mikkel", achternaam: "Larsen", email: "mikkel.larsen@nordlys.example.dk", telefoon: "24 56 78 90", adres: "Albanigade 7", postcode: "5000", plaats: "Odense", geboortedatum: "1982-11-09", bsn: "0911825555", companyKey: "energy" },
      { voornaam: "Emma", achternaam: "Christensen", email: "emma.christensen@example.dk", telefoon: "25 67 89 01", adres: "Jægersborggade 22", postcode: "2200", plaats: "København", geboortedatum: "1997-02-27", bsn: "2702976666", companyKey: "clinic" },
      { voornaam: "Henrik", achternaam: "Madsen", email: "henrik.madsen@eksempel.example.dk", telefoon: "26 78 90 12", adres: "Vester Voldgade 3", postcode: "1552", plaats: "København", geboortedatum: "1969-08-14", bsn: "1408697777", companyKey: "council" },
      { voornaam: "Fatima", achternaam: "Hassan", email: "fatima.hassan@example.dk", telefoon: "27 89 01 23", adres: "Istedgade 11", postcode: "1650", plaats: "København", geboortedatum: "1988-12-01", bsn: "0112888888", companyKey: "" },
    ],
  },
  de: {
    companies: [
      { key: "council", handelsnaam: "Stadt Musterstadt", kvk: "HRB 12345", adres: "Rathausplatz 1", postcode: "10115", plaats: "Berlin", email: "info@musterstadt.example.de", telefoon: "030 1234567", notities: "Beispielkommune." },
      { key: "builder", handelsnaam: "Bauunternehmen Linden GmbH", kvk: "HRB 87654", adres: "Industriestraße 44", postcode: "20095", plaats: "Hamburg", email: "buero@linden.example.de", telefoon: "040 1234567", notities: "Bauunternehmen." },
      { key: "legal", handelsnaam: "Kanzlei Hoffmann & Partner", kvk: "HRB 11223", adres: "Königstraße 8", postcode: "70173", plaats: "Stuttgart", email: "mail@hoffmann.example.de", telefoon: "0711 123456", notities: "Rechtsanwaltskanzlei." },
      { key: "housing", handelsnaam: "Wohnungsbaugesellschaft Rheinblick", kvk: "HRB 55667", adres: "Rheinstraße 20", postcode: "50667", plaats: "Köln", email: "info@rheinblick.example.de", telefoon: "0221 123456", notities: "Wohnungsunternehmen." },
      { key: "energy", handelsnaam: "Grünfeld Energie AG", kvk: "HRB 33445", adres: "Hafenstraße 3", postcode: "80331", plaats: "München", email: "kontakt@gruenfeld.example.de", telefoon: "089 1234567", notities: "Energieversorger." },
      { key: "clinic", handelsnaam: "Hausarztpraxis Am Markt", kvk: "HRB 77889", adres: "Marktstraße 15", postcode: "60311", plaats: "Frankfurt", email: "empfang@ammarkt.example.de", telefoon: "069 1234567", notities: "Hausarztpraxis." },
    ],
    persons: [
      { voornaam: "Thomas", achternaam: "Müller", email: "thomas.mueller@example.de", telefoon: "0151 11111111", adres: "Unter den Linden 12", postcode: "10117", plaats: "Berlin", geboortedatum: "1978-04-12", bsn: "111222333", companyKey: "" },
      { voornaam: "Anna", achternaam: "Schmidt", email: "anna.schmidt@linden.example.de", telefoon: "0151 22222222", adres: "Reeperbahn 8", postcode: "20359", plaats: "Hamburg", geboortedatum: "1991-09-03", bsn: "222333444", companyKey: "builder" },
      { voornaam: "Jonas", achternaam: "Weber", email: "jonas.weber@hoffmann.example.de", telefoon: "0151 33333333", adres: "Königstraße 40", postcode: "70173", plaats: "Stuttgart", geboortedatum: "1985-01-22", bsn: "333444555", companyKey: "legal" },
      { voornaam: "Sophie", achternaam: "Becker", email: "sophie.becker@rheinblick.example.de", telefoon: "0151 44444444", adres: "Hohenzollernring 19", postcode: "50672", plaats: "Köln", geboortedatum: "1994-06-18", bsn: "444555666", companyKey: "housing" },
      { voornaam: "Lukas", achternaam: "Wagner", email: "lukas.wagner@gruenfeld.example.de", telefoon: "0151 55555555", adres: "Maximilianstraße 7", postcode: "80539", plaats: "München", geboortedatum: "1982-11-09", bsn: "555666777", companyKey: "energy" },
      { voornaam: "Laura", achternaam: "Hoffmann", email: "laura.hoffmann@example.de", telefoon: "0151 66666666", adres: "Zeil 22", postcode: "60313", plaats: "Frankfurt", geboortedatum: "1997-02-27", bsn: "666777888", companyKey: "clinic" },
      { voornaam: "Michael", achternaam: "Fischer", email: "michael.fischer@musterstadt.example.de", telefoon: "0151 77777777", adres: "Alexanderplatz 3", postcode: "10178", plaats: "Berlin", geboortedatum: "1969-08-14", bsn: "777888999", companyKey: "council" },
      { voornaam: "Fatima", achternaam: "Yilmaz", email: "fatima.yilmaz@example.de", telefoon: "0151 88888888", adres: "Hauptbahnhof 11", postcode: "20259", plaats: "Hamburg", geboortedatum: "1988-12-01", bsn: "888999000", companyKey: "" },
    ],
  },
};

const { parseStreet } = require("./format");

const COUNTRIES = {
  en: "United Kingdom",
  nl: "Nederland",
  da: "Danmark",
  de: "Deutschland",
};

function demoPack(lang) {
  const pack = packs[lang] || packs.en;
  const land = COUNTRIES[lang] || COUNTRIES.en;
  return {
    companies: pack.companies,
    persons: pack.persons.map((person, index) => {
      const parsed = parseStreet(person.adres);
      return {
        ...person,
        straat: person.straat || parsed.straat,
        huisnummer: person.huisnummer || parsed.huisnummer,
        land: person.land || land,
        geslacht: person.geslacht || (index % 2 ? "vrouw" : "man"),
      };
    }),
  };
}

module.exports = { demoPack };
