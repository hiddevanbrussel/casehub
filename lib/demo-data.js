const { parseStreet } = require("./format");

const packs = {
  nl: {
    land: "Nederland",
    companies: [
      { key: "ajax", handelsnaam: "AFC Ajax", kvk: "24112233", adres: "Johan Cruijff Boulevard 1", postcode: "1101 AX", plaats: "Amsterdam", email: "info@ajax.example.nl", telefoon: "020 496 0101", notities: "Voetbalclub uit Amsterdam." },
      { key: "feyenoord", handelsnaam: "Feyenoord Rotterdam", kvk: "24113344", adres: "Van Zandvlietplein 1", postcode: "3077 AA", plaats: "Rotterdam", email: "info@feyenoord.example.nl", telefoon: "010 496 0202", notities: "Voetbalclub uit Rotterdam." },
      { key: "psv", handelsnaam: "PSV Eindhoven", kvk: "24114455", adres: "Frederiklaan 10a", postcode: "5616 NH", plaats: "Eindhoven", email: "info@psv.example.nl", telefoon: "040 496 0303", notities: "Voetbalclub uit Eindhoven." },
      { key: "az", handelsnaam: "AZ Alkmaar", kvk: "24115566", adres: "Stadionweg 1", postcode: "1812 AZ", plaats: "Alkmaar", email: "info@az.example.nl", telefoon: "072 496 0404", notities: "Voetbalclub uit Alkmaar." },
      { key: "utrecht", handelsnaam: "FC Utrecht", kvk: "24116677", adres: "Herculesplein 241", postcode: "3584 AA", plaats: "Utrecht", email: "info@fcutrecht.example.nl", telefoon: "030 496 0505", notities: "Voetbalclub uit Utrecht." },
      { key: "heerenveen", handelsnaam: "sc Heerenveen", kvk: "24117788", adres: "Abe Lenstra Boulevard 19", postcode: "8448 JA", plaats: "Heerenveen", email: "info@sc-heerenveen.example.nl", telefoon: "0513 496 060", notities: "Voetbalclub uit Heerenveen." },
    ],
    persons: [
      { key: "cruijff", voornaam: "Johan", achternaam: "Cruijff", geslacht: "man", email: "johan.cruijff@ajax.example.nl", telefoon: "06 1111 0101", adres: "Olympiaplein 12", postcode: "1077 CS", plaats: "Amsterdam", geboortedatum: "1947-04-25", bsn: "111222333", companyKey: "ajax" },
      { key: "vanbasten", voornaam: "Marco", tussenvoegsel: "van", achternaam: "Basten", geslacht: "man", email: "marco.vanbasten@fcutrecht.example.nl", telefoon: "06 1111 0202", adres: "Maliebaan 40", postcode: "3581 CS", plaats: "Utrecht", geboortedatum: "1964-10-31", bsn: "222333444", companyKey: "utrecht" },
      { key: "gullit", voornaam: "Ruud", achternaam: "Gullit", geslacht: "man", email: "ruud.gullit@feyenoord.example.nl", telefoon: "06 1111 0303", adres: "Westersingel 18", postcode: "3014 GP", plaats: "Rotterdam", geboortedatum: "1962-09-01", bsn: "333444555", companyKey: "feyenoord" },
      { key: "bergkamp", voornaam: "Dennis", achternaam: "Bergkamp", geslacht: "man", email: "dennis.bergkamp@ajax.example.nl", telefoon: "06 1111 0404", adres: "Beethovenstraat 21", postcode: "1077 HZ", plaats: "Amsterdam", geboortedatum: "1969-05-10", bsn: "444555666", companyKey: "ajax" },
      { key: "nistelrooy", voornaam: "Ruud", tussenvoegsel: "van", achternaam: "Nistelrooy", geslacht: "man", email: "ruud.vannistelrooy@psv.example.nl", telefoon: "06 1111 0505", adres: "Molenstraat 7", postcode: "5341 GC", plaats: "Oss", geboortedatum: "1976-07-01", bsn: "555666777", companyKey: "psv" },
      { key: "koeman", voornaam: "Ronald", achternaam: "Koeman", geslacht: "man", email: "ronald.koeman@psv.example.nl", telefoon: "06 1111 0606", adres: "Westzijde 15", postcode: "1506 EE", plaats: "Zaandam", geboortedatum: "1963-03-21", bsn: "666777888", companyKey: "psv" },
      { key: "lenstra", voornaam: "Abe", achternaam: "Lenstra", geslacht: "man", email: "abe.lenstra@sc-heerenveen.example.nl", telefoon: "06 1111 0707", adres: "Crackstraat 9", postcode: "8441 ES", plaats: "Heerenveen", geboortedatum: "1920-11-27", bsn: "777888999", companyKey: "heerenveen" },
      { key: "vangalen", voornaam: "Barry", tussenvoegsel: "van", achternaam: "Galen", geslacht: "man", email: "barry.vangalen@az.example.nl", telefoon: "06 1111 0808", adres: "Langestraat 22", postcode: "1811 JM", plaats: "Alkmaar", geboortedatum: "1970-04-04", bsn: "888999000", companyKey: "az" },
    ],
    cases: [
      { key: "hulding", companyKey: "ajax", personKey: "cruijff", zaaktypeHint: "omgevings", status: "in_behandeling", prioriteit: "hoog", voortgang: 55, startDays: -12, deadlineDays: 14, referentie: "EV-2026-014", titel: "Evenementenvergunning huldiging Museumplein", omschrijving: "Aanvraag voor een huldiging van de selectie op het Museumplein, met podium, geluid en publieksvakken." },
      { key: "geluid", companyKey: "feyenoord", personKey: "gullit", zaaktypeHint: "bezwaar", status: "wacht_op_info", prioriteit: "normaal", voortgang: 25, startDays: -20, deadlineDays: 21, referentie: "BZ-2026-088", titel: "Bezwaar geluidsnorm avondwedstrijd De Kuip", omschrijving: "Omwonenden maken bezwaar tegen de geluidsnorm bij doordeweekse avondwedstrijden. Verzoek om extra metingen." },
      { key: "tribune", companyKey: "psv", personKey: "nistelrooy", zaaktypeHint: "omgevings", status: "nieuw", prioriteit: "hoog", voortgang: 0, startDays: -3, deadlineDays: 40, referentie: "OV-2026-221", titel: "Omgevingsvergunning tribune Philips Stadion", omschrijving: "Aanvraag tot uitbreiding van de lange zijde. Toetsing van constructie, verkeer en evenementenafwikkeling." },
      { key: "uitvak", companyKey: "utrecht", personKey: "vanbasten", zaaktypeHint: "melding", status: "nieuw", prioriteit: "urgent", voortgang: 0, startDays: -8, deadlineDays: -2, referentie: "ML-2026-441", titel: "Melding onveilige uitvakken Galgenwaard", omschrijving: "Stewards en omwonenden melden knelpunten bij het uitvak na de rivalenwedstrijd. Verzoek om extra inzet." },
      { key: "licht", companyKey: "heerenveen", personKey: "lenstra", zaaktypeHint: "omgevings", status: "nieuw", prioriteit: "normaal", voortgang: 0, startDays: -1, deadlineDays: 28, referentie: "LP-2026-019", titel: "Aanvraag lichtplan Abe Lenstra Stadion", omschrijving: "Nieuw lichtplan voor avondwedstrijden. Beoordeling van lichthinder voor de omliggende woonwijk." },
      { key: "bomen", companyKey: "az", personKey: "vangalen", zaaktypeHint: "kappen", status: "in_behandeling", prioriteit: "normaal", voortgang: 40, startDays: -6, deadlineDays: 10, referentie: "KV-2026-073", titel: "Kapvergunning bomen Stadionweg", omschrijving: "Aanvraag tot kappen van vier linden langs de Stadionweg wegens worteldruk op het wegdek richting de hoofdingang." },
    ],
    caseTypes: [
      { key: "omgevings", naam: "Omgevingsvergunning", leadTimeDays: 42 },
      { key: "bezwaar", naam: "Bezwaar", leadTimeDays: 28 },
      { key: "melding", naam: "Melding", leadTimeDays: 14 },
      { key: "kappen", naam: "Kapvergunning", leadTimeDays: 21 },
    ],
  },
  en: {
    land: "United Kingdom",
    companies: [
      { key: "manutd", handelsnaam: "Manchester United", kvk: "00024423", adres: "Sir Matt Busby Way 1", postcode: "M16 0RA", plaats: "Manchester", email: "info@manutd.example.co.uk", telefoon: "0161 496 0101", notities: "Football club from Manchester." },
      { key: "liverpool", handelsnaam: "Liverpool FC", kvk: "00035668", adres: "Anfield Road 5", postcode: "L4 0TH", plaats: "Liverpool", email: "info@liverpool.example.co.uk", telefoon: "0151 496 0202", notities: "Football club from Liverpool." },
      { key: "arsenal", handelsnaam: "Arsenal FC", kvk: "00109244", adres: "Hornsey Road 75", postcode: "N7 7AJ", plaats: "London", email: "info@arsenal.example.co.uk", telefoon: "020 496 0303", notities: "Football club from London." },
      { key: "chelsea", handelsnaam: "Chelsea FC", kvk: "00196337", adres: "Fulham Road 1", postcode: "SW6 1HS", plaats: "London", email: "info@chelsea.example.co.uk", telefoon: "020 496 0404", notities: "Football club from London." },
      { key: "tottenham", handelsnaam: "Tottenham Hotspur", kvk: "00057499", adres: "High Road 748", postcode: "N17 0BX", plaats: "London", email: "info@tottenham.example.co.uk", telefoon: "020 496 0505", notities: "Football club from London." },
      { key: "mancity", handelsnaam: "Manchester City", kvk: "00040946", adres: "Etihad Campus 1", postcode: "M11 3FF", plaats: "Manchester", email: "info@mancity.example.co.uk", telefoon: "0161 496 0606", notities: "Football club from Manchester." },
    ],
    persons: [
      { key: "charlton", voornaam: "Bobby", achternaam: "Charlton", geslacht: "man", email: "bobby.charlton@manutd.example.co.uk", telefoon: "07700 900101", adres: "Warwick Road 12", postcode: "M16 0AD", plaats: "Manchester", geboortedatum: "1937-10-11", bsn: "211222333", companyKey: "manutd" },
      { key: "best", voornaam: "George", achternaam: "Best", geslacht: "man", email: "george.best@manutd.example.co.uk", telefoon: "07700 900202", adres: "Chester Road 44", postcode: "M32 0RS", plaats: "Manchester", geboortedatum: "1946-05-22", bsn: "222333445", companyKey: "manutd" },
      { key: "dalglish", voornaam: "Kenny", achternaam: "Dalglish", geslacht: "man", email: "kenny.dalglish@liverpool.example.co.uk", telefoon: "07700 900303", adres: "Walton Breck Road 18", postcode: "L4 0RQ", plaats: "Liverpool", geboortedatum: "1951-03-04", bsn: "333444556", companyKey: "liverpool" },
      { key: "rush", voornaam: "Ian", achternaam: "Rush", geslacht: "man", email: "ian.rush@liverpool.example.co.uk", telefoon: "07700 900404", adres: "Anfield Road 21", postcode: "L4 0TH", plaats: "Liverpool", geboortedatum: "1961-10-20", bsn: "444555667", companyKey: "liverpool" },
      { key: "henry", voornaam: "Thierry", achternaam: "Henry", geslacht: "man", email: "thierry.henry@arsenal.example.co.uk", telefoon: "07700 900505", adres: "Highbury Hill 7", postcode: "N5 1BU", plaats: "London", geboortedatum: "1977-08-17", bsn: "555666778", companyKey: "arsenal" },
      { key: "osgood", voornaam: "Peter", achternaam: "Osgood", geslacht: "man", email: "peter.osgood@chelsea.example.co.uk", telefoon: "07700 900606", adres: "Fulham Road 15", postcode: "SW6 1EX", plaats: "London", geboortedatum: "1947-02-20", bsn: "666777889", companyKey: "chelsea" },
      { key: "lineker", voornaam: "Gary", achternaam: "Lineker", geslacht: "man", email: "gary.lineker@tottenham.example.co.uk", telefoon: "07700 900707", adres: "Park Lane 9", postcode: "N17 0AP", plaats: "London", geboortedatum: "1960-11-30", bsn: "777888990", companyKey: "tottenham" },
      { key: "bell", voornaam: "Colin", achternaam: "Bell", geslacht: "man", email: "colin.bell@mancity.example.co.uk", telefoon: "07700 900808", adres: "Ashton New Road 22", postcode: "M11 4TQ", plaats: "Manchester", geboortedatum: "1946-02-26", bsn: "888999001", companyKey: "mancity" },
    ],
    cases: [
      { key: "hulding", companyKey: "manutd", personKey: "charlton", zaaktypeHint: "omgevings", status: "in_behandeling", prioriteit: "hoog", voortgang: 55, startDays: -12, deadlineDays: 14, referentie: "EV-2026-114", titel: "Event permit for parade at Old Trafford", omschrijving: "Application for a squad celebration outside Old Trafford, with a stage, sound and public areas." },
      { key: "geluid", companyKey: "liverpool", personKey: "dalglish", zaaktypeHint: "bezwaar", status: "wacht_op_info", prioriteit: "normaal", voortgang: 25, startDays: -20, deadlineDays: 21, referentie: "BZ-2026-188", titel: "Objection to noise limits for evening matches at Anfield", omschrijving: "Residents object to the noise limits for weekday evening matches. They ask for extra measurements." },
      { key: "tribune", companyKey: "arsenal", personKey: "henry", zaaktypeHint: "omgevings", status: "nieuw", prioriteit: "hoog", voortgang: 0, startDays: -3, deadlineDays: 40, referentie: "OV-2026-321", titel: "Planning permission for the Emirates Stadium stand", omschrijving: "Application to extend the long side. Assessment of structure, traffic and event flow." },
      { key: "uitvak", companyKey: "chelsea", personKey: "osgood", zaaktypeHint: "melding", status: "nieuw", prioriteit: "urgent", voortgang: 0, startDays: -8, deadlineDays: -2, referentie: "ML-2026-541", titel: "Report on unsafe away section at Stamford Bridge", omschrijving: "Stewards and residents report pinch points at the away section after the derby. They ask for extra staffing." },
      { key: "licht", companyKey: "mancity", personKey: "bell", zaaktypeHint: "omgevings", status: "nieuw", prioriteit: "normaal", voortgang: 0, startDays: -1, deadlineDays: 28, referentie: "LP-2026-119", titel: "Lighting plan application for the Etihad Stadium", omschrijving: "New lighting plan for evening matches. Assessment of light nuisance for the surrounding neighbourhood." },
      { key: "bomen", companyKey: "tottenham", personKey: "lineker", zaaktypeHint: "kappen", status: "in_behandeling", prioriteit: "normaal", voortgang: 40, startDays: -6, deadlineDays: 10, referentie: "KV-2026-173", titel: "Tree-felling permit on Tottenham High Road", omschrijving: "Application to fell four lime trees along High Road because of root pressure on the road towards the main entrance." },
    ],
    caseTypes: [
      { key: "omgevings", naam: "Planning permission", leadTimeDays: 42 },
      { key: "bezwaar", naam: "Objection", leadTimeDays: 28 },
      { key: "melding", naam: "Report", leadTimeDays: 14 },
      { key: "kappen", naam: "Tree-felling permit", leadTimeDays: 21 },
    ],
  },
  da: {
    land: "Danmark",
    companies: [
      { key: "fck", handelsnaam: "FC København", kvk: "25105287", adres: "Øster Allé 50", postcode: "2100", plaats: "København", email: "info@fck.example.dk", telefoon: "33 12 01 01", notities: "Fodboldklub fra København." },
      { key: "brondby", handelsnaam: "Brøndby IF", kvk: "10602742", adres: "Brøndby Stadion 30", postcode: "2605", plaats: "Brøndby", email: "info@brondby.example.dk", telefoon: "43 63 08 10", notities: "Fodboldklub fra Brøndby." },
      { key: "agf", handelsnaam: "AGF", kvk: "26259495", adres: "Stadion Allé 70", postcode: "8000", plaats: "Aarhus", email: "info@agf.example.dk", telefoon: "86 13 07 11", notities: "Fodboldklub fra Aarhus." },
      { key: "ob", handelsnaam: "Odense Boldklub", kvk: "45974811", adres: "Højstrupvej 27", postcode: "5200", plaats: "Odense", email: "info@ob.example.dk", telefoon: "66 12 01 13", notities: "Fodboldklub fra Odense." },
      { key: "aab", handelsnaam: "AaB", kvk: "10403719", adres: "Harald Jensens Vej 8", postcode: "9000", plaats: "Aalborg", email: "info@aab.example.dk", telefoon: "98 13 01 15", notities: "Fodboldklub fra Aalborg." },
      { key: "fcm", handelsnaam: "FC Midtjylland", kvk: "26933095", adres: "Kaj Zartows Vej 5", postcode: "7400", plaats: "Herning", email: "info@fcm.example.dk", telefoon: "96 27 01 17", notities: "Fodboldklub fra Herning." },
    ],
    persons: [
      { key: "mlaudrup", voornaam: "Michael", achternaam: "Laudrup", geslacht: "man", email: "michael.laudrup@fck.example.dk", telefoon: "20 11 01 01", adres: "Østerbrogade 12", postcode: "2100", plaats: "København", geboortedatum: "1964-06-15", bsn: "311222333", companyKey: "fck" },
      { key: "blaudrup", voornaam: "Brian", achternaam: "Laudrup", geslacht: "man", email: "brian.laudrup@brondby.example.dk", telefoon: "20 11 02 02", adres: "Nygårdsvej 18", postcode: "2605", plaats: "Brøndby", geboortedatum: "1969-02-22", bsn: "322333444", companyKey: "brondby" },
      { key: "schmeichel", voornaam: "Peter", achternaam: "Schmeichel", geslacht: "man", email: "peter.schmeichel@brondby.example.dk", telefoon: "20 11 03 03", adres: "Park Allé 9", postcode: "2605", plaats: "Brøndby", geboortedatum: "1963-11-18", bsn: "333444557", companyKey: "brondby" },
      { key: "tofting", voornaam: "Stig", achternaam: "Tøfting", geslacht: "man", email: "stig.tofting@agf.example.dk", telefoon: "20 11 04 04", adres: "Trøjborgvej 21", postcode: "8200", plaats: "Aarhus", geboortedatum: "1969-08-14", bsn: "344555666", companyKey: "agf" },
      { key: "hogh", voornaam: "Lars", achternaam: "Høgh", geslacht: "man", email: "lars.hogh@ob.example.dk", telefoon: "20 11 05 05", adres: "Albanigade 7", postcode: "5000", plaats: "Odense", geboortedatum: "1959-01-14", bsn: "355666777", companyKey: "ob" },
      { key: "gronkjaer", voornaam: "Jesper", achternaam: "Grønkjær", geslacht: "man", email: "jesper.gronkjaer@aab.example.dk", telefoon: "20 11 06 06", adres: "Vesterbro 15", postcode: "9000", plaats: "Aalborg", geboortedatum: "1977-08-12", bsn: "366777888", companyKey: "aab" },
      { key: "elkjaer", voornaam: "Preben", achternaam: "Elkjær", geslacht: "man", email: "preben.elkjaer@fcm.example.dk", telefoon: "20 11 07 07", adres: "Østergade 9", postcode: "7400", plaats: "Herning", geboortedatum: "1957-09-11", bsn: "377888999", companyKey: "fcm" },
      { key: "tomasson", voornaam: "Jon Dahl", achternaam: "Tomasson", geslacht: "man", email: "jon.tomasson@fck.example.dk", telefoon: "20 11 08 08", adres: "Sortedam Dossering 22", postcode: "2100", plaats: "København", geboortedatum: "1976-08-29", bsn: "388999000", companyKey: "fck" },
    ],
    cases: [
      { key: "hulding", companyKey: "fck", personKey: "mlaudrup", zaaktypeHint: "omgevings", status: "in_behandeling", prioriteit: "hoog", voortgang: 55, startDays: -12, deadlineDays: 14, referentie: "EV-2026-214", titel: "Arrangementstilladelse til hyldest på Rådhuspladsen", omschrijving: "Ansøgning om hyldest af truppen på Rådhuspladsen med scene, lyd og publikumsområder." },
      { key: "geluid", companyKey: "brondby", personKey: "schmeichel", zaaktypeHint: "bezwaar", status: "wacht_op_info", prioriteit: "normaal", voortgang: 25, startDays: -20, deadlineDays: 21, referentie: "BZ-2026-288", titel: "Klage over støjgrænse ved aftenkamp på Brøndby Stadion", omschrijving: "Naboer klager over støjgrænsen ved aftenkampe på hverdage. Der bedes om ekstra målinger." },
      { key: "tribune", companyKey: "agf", personKey: "tofting", zaaktypeHint: "omgevings", status: "nieuw", prioriteit: "hoog", voortgang: 0, startDays: -3, deadlineDays: 40, referentie: "OV-2026-421", titel: "Miljøtilladelse til tribune på Ceres Park", omschrijving: "Ansøgning om udvidelse af langsiden. Vurdering af konstruktion, trafik og afvikling." },
      { key: "uitvak", companyKey: "aab", personKey: "gronkjaer", zaaktypeHint: "melding", status: "nieuw", prioriteit: "urgent", voortgang: 0, startDays: -8, deadlineDays: -2, referentie: "ML-2026-641", titel: "Anmeldelse af utryg udebaneafdeling i Aalborg", omschrijving: "Stewards og naboer melder om trængsel ved udebaneafdelingen efter derbyet. Der ønskes ekstra bemanding." },
      { key: "licht", companyKey: "fcm", personKey: "elkjaer", zaaktypeHint: "omgevings", status: "nieuw", prioriteit: "normaal", voortgang: 0, startDays: -1, deadlineDays: 28, referentie: "LP-2026-219", titel: "Ansøgning om lysplan til MCH Arena", omschrijving: "Ny lysplan til aftenkampe. Vurdering af lysgener for det omkringliggende boligområde." },
      { key: "bomen", companyKey: "ob", personKey: "hogh", zaaktypeHint: "kappen", status: "in_behandeling", prioriteit: "normaal", voortgang: 40, startDays: -6, deadlineDays: 10, referentie: "KV-2026-273", titel: "Tilladelse til fældning af træer ved Højstrupvej", omschrijving: "Ansøgning om fældning af fire lindetræer langs Højstrupvej på grund af rodtryk på kørebanen mod hovedindgangen." },
    ],
    caseTypes: [
      { key: "omgevings", naam: "Miljøtilladelse", leadTimeDays: 42 },
      { key: "bezwaar", naam: "Klage", leadTimeDays: 28 },
      { key: "melding", naam: "Anmeldelse", leadTimeDays: 14 },
      { key: "kappen", naam: "Fældningstilladelse", leadTimeDays: 21 },
    ],
  },
  de: {
    land: "Deutschland",
    companies: [
      { key: "bayern", handelsnaam: "FC Bayern München", kvk: "HRB 42168", adres: "Säbener Straße 51", postcode: "81547", plaats: "München", email: "info@bayern.example.de", telefoon: "089 496 0101", notities: "Fußballverein aus München." },
      { key: "bvb", handelsnaam: "Borussia Dortmund", kvk: "HRB 1421", adres: "Strobelallee 50", postcode: "44139", plaats: "Dortmund", email: "info@bvb.example.de", telefoon: "0231 496 0202", notities: "Fußballverein aus Dortmund." },
      { key: "hsv", handelsnaam: "Hamburger SV", kvk: "VR 3768", adres: "Sylvesterallee 7", postcode: "22525", plaats: "Hamburg", email: "info@hsv.example.de", telefoon: "040 496 0303", notities: "Fußballverein aus Hamburg." },
      { key: "werder", handelsnaam: "Werder Bremen", kvk: "HRB 20608", adres: "Franz-Böhmert-Straße 1c", postcode: "28205", plaats: "Bremen", email: "info@werder.example.de", telefoon: "0421 496 0404", notities: "Fußballverein aus Bremen." },
      { key: "koeln", handelsnaam: "1. FC Köln", kvk: "VR 5755", adres: "Aachener Straße 999", postcode: "50933", plaats: "Köln", email: "info@fc-koeln.example.de", telefoon: "0221 496 0505", notities: "Fußballverein aus Köln." },
      { key: "schalke", handelsnaam: "FC Schalke 04", kvk: "VR 638", adres: "Ernst-Kuzorra-Weg 1", postcode: "45891", plaats: "Gelsenkirchen", email: "info@schalke.example.de", telefoon: "0209 496 0606", notities: "Fußballverein aus Gelsenkirchen." },
    ],
    persons: [
      { key: "beckenbauer", voornaam: "Franz", achternaam: "Beckenbauer", geslacht: "man", email: "franz.beckenbauer@bayern.example.de", telefoon: "0171 1110101", adres: "Leopoldstraße 12", postcode: "80802", plaats: "München", geboortedatum: "1945-09-11", bsn: "411222333", companyKey: "bayern" },
      { key: "mueller", voornaam: "Gerd", achternaam: "Müller", geslacht: "man", email: "gerd.mueller@bayern.example.de", telefoon: "0171 1110202", adres: "Tegernseer Landstraße 40", postcode: "81541", plaats: "München", geboortedatum: "1945-11-03", bsn: "422333444", companyKey: "bayern" },
      { key: "sammer", voornaam: "Matthias", achternaam: "Sammer", geslacht: "man", email: "matthias.sammer@bvb.example.de", telefoon: "0171 1110303", adres: "Rheinlanddamm 18", postcode: "44139", plaats: "Dortmund", geboortedatum: "1967-09-05", bsn: "433444555", companyKey: "bvb" },
      { key: "seeler", voornaam: "Uwe", achternaam: "Seeler", geslacht: "man", email: "uwe.seeler@hsv.example.de", telefoon: "0171 1110404", adres: "Rothenbaumchaussee 21", postcode: "20148", plaats: "Hamburg", geboortedatum: "1936-11-05", bsn: "444555668", companyKey: "hsv" },
      { key: "voeller", voornaam: "Rudi", achternaam: "Völler", geslacht: "man", email: "rudi.voeller@werder.example.de", telefoon: "0171 1110505", adres: "Osterdeich 7", postcode: "28205", plaats: "Bremen", geboortedatum: "1960-04-13", bsn: "455666777", companyKey: "werder" },
      { key: "overath", voornaam: "Wolfgang", achternaam: "Overath", geslacht: "man", email: "wolfgang.overath@fc-koeln.example.de", telefoon: "0171 1110606", adres: "Aachener Straße 15", postcode: "50931", plaats: "Köln", geboortedatum: "1943-09-29", bsn: "466777888", companyKey: "koeln" },
      { key: "fischer", voornaam: "Klaus", achternaam: "Fischer", geslacht: "man", email: "klaus.fischer@schalke.example.de", telefoon: "0171 1110707", adres: "Kurt-Schumacher-Straße 9", postcode: "45881", plaats: "Gelsenkirchen", geboortedatum: "1949-12-27", bsn: "477888999", companyKey: "schalke" },
      { key: "rummenigge", voornaam: "Karl-Heinz", achternaam: "Rummenigge", geslacht: "man", email: "karlheinz.rummenigge@bayern.example.de", telefoon: "0171 1110808", adres: "Prinzregentenstraße 22", postcode: "80538", plaats: "München", geboortedatum: "1955-09-25", bsn: "488999000", companyKey: "bayern" },
    ],
    cases: [
      { key: "hulding", companyKey: "bayern", personKey: "beckenbauer", zaaktypeHint: "omgevings", status: "in_behandeling", prioriteit: "hoog", voortgang: 55, startDays: -12, deadlineDays: 14, referentie: "EV-2026-314", titel: "Veranstaltungserlaubnis Ehrung am Marienplatz", omschrijving: "Antrag auf eine Ehrung der Mannschaft am Marienplatz, mit Bühne, Ton und Publikumsbereichen." },
      { key: "geluid", companyKey: "bvb", personKey: "sammer", zaaktypeHint: "bezwaar", status: "wacht_op_info", prioriteit: "normaal", voortgang: 25, startDays: -20, deadlineDays: 21, referentie: "BZ-2026-388", titel: "Widerspruch gegen Lärmwerte bei Abendspielen im Westfalenstadion", omschrijving: "Anwohner widersprechen den Lärmwerten bei Abendspielen unter der Woche. Bitte um zusätzliche Messungen." },
      { key: "tribune", companyKey: "hsv", personKey: "seeler", zaaktypeHint: "omgevings", status: "nieuw", prioriteit: "hoog", voortgang: 0, startDays: -3, deadlineDays: 40, referentie: "OV-2026-521", titel: "Umweltgenehmigung Tribüne Volksparkstadion", omschrijving: "Antrag auf Erweiterung der Längsseite. Prüfung von Konstruktion, Verkehr und Ablauf." },
      { key: "uitvak", companyKey: "koeln", personKey: "overath", zaaktypeHint: "melding", status: "nieuw", prioriteit: "urgent", voortgang: 0, startDays: -8, deadlineDays: -2, referentie: "ML-2026-741", titel: "Meldung unsicherer Gästebereich im Rheinenergiestadion", omschrijving: "Ordner und Anwohner melden Engpässe im Gästebereich nach dem Derby. Bitte um zusätzliches Personal." },
      { key: "licht", companyKey: "werder", personKey: "voeller", zaaktypeHint: "omgevings", status: "nieuw", prioriteit: "normaal", voortgang: 0, startDays: -1, deadlineDays: 28, referentie: "LP-2026-319", titel: "Antrag Lichtkonzept Weserstadion", omschrijving: "Neues Lichtkonzept für Abendspiele. Prüfung der Lichtbelastung für die umliegende Wohnbebauung." },
      { key: "bomen", companyKey: "schalke", personKey: "fischer", zaaktypeHint: "kappen", status: "in_behandeling", prioriteit: "normaal", voortgang: 40, startDays: -6, deadlineDays: 10, referentie: "KV-2026-373", titel: "Fällgenehmigung Bäume am Ernst-Kuzorra-Weg", omschrijving: "Antrag auf Fällung von vier Linden am Ernst-Kuzorra-Weg wegen Wurzeldruck auf die Fahrbahn zur Haupteinfahrt." },
    ],
    caseTypes: [
      { key: "omgevings", naam: "Umweltgenehmigung", leadTimeDays: 42 },
      { key: "bezwaar", naam: "Widerspruch", leadTimeDays: 28 },
      { key: "melding", naam: "Meldung", leadTimeDays: 14 },
      { key: "kappen", naam: "Fällgenehmigung", leadTimeDays: 21 },
    ],
  },
};

function demoPack(lang) {
  const pack = packs[lang] || packs.en;
  return {
    companies: pack.companies.map((company) => ({ ...company })),
    persons: pack.persons.map((person) => {
      const parsed = parseStreet(person.adres);
      return {
        ...person,
        straat: person.straat || parsed.straat,
        huisnummer: person.huisnummer || parsed.huisnummer,
        land: pack.land,
        geslacht: person.geslacht || "man",
      };
    }),
    cases: pack.cases.map((item) => ({ ...item })),
    caseTypes: (pack.caseTypes || []).map((item) => ({ ...item })),
  };
}

module.exports = { demoPack };
