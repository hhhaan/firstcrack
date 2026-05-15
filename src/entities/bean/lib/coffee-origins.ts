export const COMMON_ORIGINS = [
    'Ethiopia',
    'Colombia',
    'Brazil',
    'Kenya',
    'Guatemala',
    'Honduras',
    'Costa Rica',
    'Panama',
    'Peru',
    'Rwanda',
    'Burundi',
    'Yemen',
    'Indonesia',
    'El Salvador',
    'Nicaragua',
    'Tanzania',
];

export const REGIONS_BY_ORIGIN: Record<string, string[]> = {
    Ethiopia: ['Yirgacheffe', 'Sidama', 'Guji', 'Harrar', 'Limu', 'Kaffa', 'Bench Maji'],
    Colombia: ['Huila', 'Nariño', 'Antioquia', 'Cauca', 'Tolima', 'Santander', 'Sierra Nevada'],
    Brazil: ['Sul de Minas', 'Cerrado', 'Mogiana', 'Chapada Diamantina', 'Espírito Santo', 'Bahia'],
    Kenya: ['Nyeri', 'Kirinyaga', 'Kiambu', 'Muranga', 'Embu', 'Meru', 'Nandi'],
    Guatemala: ['Huehuetenango', 'Antigua', 'Atitlán', 'Acatenango', 'Cobán', 'Fraijanes', 'San Marcos'],
    Honduras: ['Copán', 'Marcala', 'Comayagua', 'Montecillos', 'Agalta', 'El Paraíso'],
    'Costa Rica': ['Tarrazú', 'West Valley', 'Central Valley', 'Tres Ríos', 'Brunca', 'Turrialba'],
    Panama: ['Boquete', 'Volcán', 'Renacimiento'],
    Peru: ['Cajamarca', 'Puno', 'Junín', 'San Martín', 'Amazonas', 'Cusco'],
    Rwanda: ['Nyamasheke', 'Huye', 'Kayonza', 'Rulindo', 'Gakenke'],
    Burundi: ['Kayanza', 'Ngozi', 'Muyinga', 'Gitega', 'Bubanza'],
    Yemen: ['Haraaz', 'Bani Matar', 'Rayma', 'Ismaili', 'Mattari'],
    Indonesia: ['Aceh', 'Lintong', 'Mandheling', 'Toraja', 'Flores', 'Java', 'Bali'],
    'El Salvador': ['Apaneca-Ilamatepec', 'Alotepec-Metapán', 'Cacahuatique', 'Tecapa-Chinameca'],
    Nicaragua: ['Jinotega', 'Matagalpa', 'Nueva Segovia', 'Madriz', 'Estelí'],
    Tanzania: ['Kilimanjaro', 'Arusha', 'Mbeya', 'Kagera', 'Ruvuma'],
};

export const FARMS_BY_REGION: Record<string, string[]> = {
    // ====================== ETHIOPIA ======================
    Yirgacheffe: ['Idido', 'Aricha', 'Chelelektu', 'Worka Chelbessa', 'Konga', 'Misty Valley', 'Worka Sakaro', 'Gedeb'],
    Sidama: ['Daye Bensa', 'Shantawene', 'Alde', 'Bookissa', 'Bensa', 'Chire', 'Aleta Wondo'],
    Guji: ['Shakiso', 'Uraga', 'Hambela', 'Anasora', 'Tade GG', 'Kochere', 'Lulo Coffee', 'Gesha Village'],
    Harrar: ['Harrar Estate', 'Eastern Harrar Cooperative'],
    Limu: ['Limu Coffee Cooperative'],
    Kaffa: ['Kaffa Forest Coffee', 'Bonga Cooperative'],
    'Bench Maji': ['Bench Maji Cooperative'],

    // ====================== COLOMBIA ======================
    Huila: [
        'Finca El Paraiso (Diego Samuel)',
        'La Palma y El Tucan',
        'La Macarena',
        'El Palomar',
        'Finca La Esmeralda',
        'Finca Filadelfia',
        'Finca Buena Vista',
        'La Union',
        'Palestina',
    ],
    Nariño: ['El Vergel', 'La Union', 'Finca Matarredonda'],
    Antioquia: ['Finca Lomaverde', 'Jardin Excelso'],
    Cauca: ['Finca La Esmeralda Cauca'],
    Tolima: ['Finca El Palomar Tolima'],
    Santander: ['Santander Cooperative'],
    'Sierra Nevada': ['Sierra Nevada Organic'],

    // ====================== BRAZIL ======================
    'Sul de Minas': ['Fazenda Mariano', 'Fazenda Santa Lucia', 'Fazenda Rainha'],
    Cerrado: ['Fazenda Pantano', 'Fazenda Rio Brilhante', 'Fazenda Pântano'],
    Mogiana: ['Fazenda Morada da Prata', 'Fazenda Rainha', 'Alta Mogiana Estate'],
    'Chapada Diamantina': ['Chapada Diamantina Cooperative'],
    'Espírito Santo': ['Espírito Santo Robusta Estates'],
    Bahia: ['Bahia Specialty Farms'],

    // ====================== KENYA ======================
    Nyeri: ['Kiama', 'Gichathaini', 'Kibiru', 'Nyeri Hill Farm', 'Spike Farm', 'Gifted Farm'],
    Kirinyaga: ['Kiamuthi', 'Kiangoi', 'Thunguri Coffee Factory', 'Baragwi Cooperative'],
    Kiambu: ['Kiambu Estate'],
    Muranga: ['Muranga Cooperative'],
    Embu: ['Embu Cooperative'],
    Meru: ['Meru Cooperative'],
    Nandi: ['Nandi Hills'],

    // ====================== GUATEMALA ======================
    Huehuetenango: ['JUMARP Cooperative', 'Apicus Cooperative', 'Finca La Esperanza'],
    Antigua: ['Finca Filadelfia', 'Hacienda La Esmeralda Antigua'],
    Atitlán: ['Finca San Florencio', 'Atitlán Volcanic Estates'],
    Acatenango: ['Acatenango Volcanic Farms'],
    Cobán: ['Cobán Cloud Forest'],
    Fraijanes: ['Fraijanes Estate'],
    'San Marcos': ['San Marcos Highland'],

    // ====================== HONDURAS ======================
    Copán: ['Finca Santa Elena', 'Finca Fuente Vida'],
    Marcala: ['COMSA Cooperative', 'Café Orgánico Marcala'],
    Comayagua: ['Finca Las Botijas'],
    Montecillos: ['Montecillos Cooperative'],
    Agalta: ['Agalta Cooperative'],
    'El Paraíso': ['Finca El Laurel'],

    // ====================== COSTA RICA ======================
    Tarrazú: [
        'Herbazu Micromill',
        'Don Mayo Micromill',
        'Finca La Pastora',
        'Beneficio del Rio Tarrazu',
        'Café Don Cayito',
        'La Minita Farms',
    ],
    'West Valley': ['Exclusive Coffees', 'Sumava Micromill', 'Palmichal Micromill', 'Finca Rosa Blanca'],
    'Central Valley': ['Doka Estate', 'Café Britt'],
    'Tres Ríos': ['Tres Ríos Cooperative'],
    Brunca: ['Brunca Highland'],
    Turrialba: ['Turrialba Volcanic'],

    // ====================== PANAMA ======================
    Boquete: [
        'Hacienda La Esmeralda',
        'Finca Dos Jefes',
        'Kotowa Coffee Estate',
        'Don Pachi Estate',
        'Finca Sofía',
        'Elida Estate',
        'Gran Del Val',
    ],
    Volcán: ['Volcán Coffee Farms'],
    Renacimiento: ['Renacimiento Estate'],

    // ====================== PERU ======================
    Cajamarca: ['Cajamarca Cooperative'],
    Puno: ['Puno Highland'],
    Junín: ['Junín Estate'],
    'San Martín': ['San Martín Organic'],
    Amazonas: ['Amazonas Cloud Forest'],
    Cusco: ['Cusco Machu Picchu Farms'],

    // ====================== RWANDA ======================
    Nyamasheke: ['Nyamasheke Cooperative'],
    Huye: ['Huye Mountain Coffee'],
    Kayonza: ['Kayonza Farms'],
    Rulindo: ['Rulindo Cooperative'],
    Gakenke: ['Gakenke Hills'],

    // ====================== BURUNDI ======================
    Kayanza: ['Kayanza Cooperative'],
    Ngozi: ['Ngozi Mountain'],
    Muyinga: ['Muyinga Farms'],
    Gitega: ['Gitega Cooperative'],
    Bubanza: ['Bubanza Estate'],

    // ====================== YEMEN ======================
    Haraaz: ['Haraaz Ancient Farms'],
    'Bani Matar': ['Bani Matar Heritage'],
    Rayma: ['Rayma Mountain'],
    Ismaili: ['Ismaili Cooperative'],
    Mattari: ['Mattari Traditional'],

    // ====================== INDONESIA ======================
    Aceh: ['Aceh Gayo Cooperative'],
    Lintong: ['Lintong Sumatra'],
    Mandheling: ['Mandheling Estate'],
    Toraja: ['Toraja Highland'],
    Flores: ['Flores Bajawa'],
    Java: ['Java Preanger'],
    Bali: ['Bali Kintamani'],

    // ====================== EL SALVADOR ======================
    'Apaneca-Ilamatepec': ['Apaneca Estate'],
    'Alotepec-Metapán': ['Metapán Farms'],
    Cacahuatique: ['Cacahuatique Cooperative'],
    'Tecapa-Chinameca': ['Tecapa Volcano Farms'],

    // ====================== NICARAGUA ======================
    Jinotega: ['Jinotega Cooperative'],
    Matagalpa: ['Finca La Esperanza Matagalpa'],
    'Nueva Segovia': ['Nueva Segovia Farms'],
    Madriz: ['Madriz Highland'],
    Estelí: ['Estelí Organic'],

    // ====================== TANZANIA ======================
    Kilimanjaro: ['Kilimanjaro Estate'],
    Arusha: ['Arusha Mountain'],
    Mbeya: ['Mbeya Cooperative'],
    Kagera: ['Kagera Lake'],
    Ruvuma: ['Ruvuma Farms'],
};

export const COMMON_PROCESSES = [
    'Washed',
    'Natural',
    'Honey',
    'Anaerobic',
    'Double Anaerobic',
    'Carbonic Maceration',
    'Pulped Natural',
    'Black Honey',
    'Red Honey',
    'Yellow Honey',
    'Anaerobic Natural',
    'Thermic / Thermal Shock',
    'Wet Hulled (Giling Basah)',
    'Koji Fermentation',
    'Infused',
    'Experimental',
] as const;

export const VARIETIES_BY_ORIGIN: Record<string, string[]> = {
    Ethiopia: ['Heirloom', 'Gesha (Geisha)', 'Kurume', 'Wolisho', 'Dega', 'Serto', '74110', '74112'],
    Colombia: [
        'Caturra',
        'Castillo',
        'Colombia',
        'Pink Bourbon',
        'Chiroso',
        'Sidra',
        'Gesha',
        'Bourbon',
        'Typica',
        'Tabi',
        'Maragogype',
        'Laurina',
    ],
    Brazil: [
        'Yellow Bourbon',
        'Red Bourbon',
        'Yellow Catuai',
        'Red Catuai',
        'Catucaí',
        'Mundo Novo',
        'Icatu',
        'Rubi',
        'Acauã',
    ],
    Kenya: ['SL28', 'SL34', 'Ruiru 11', 'Batian', 'K7'],
    Guatemala: ['Bourbon', 'Caturra', 'Catuaí', 'Pacamara', 'Pacas', 'Maragogype', 'Gesha'],
    Honduras: ['Bourbon', 'Caturra', 'Catuaí', 'IHCAFE 90', 'Lempira', 'Parainema'],
    'Costa Rica': ['Caturra', 'Catuai', 'Villa Sarchi', 'Gesha', 'Typica', 'SL28', 'Obatá'],
    Panama: ['Gesha (Geisha)', 'Typica', 'Caturra', 'Catuai', 'Bourbon', 'Pink Bourbon'],
    Peru: ['Caturra', 'Bourbon', 'Typica', 'Gesha', 'Catimor'],
    Rwanda: ['Bourbon', 'Caturra', 'Gesha'],
    Burundi: ['Bourbon', 'Caturra'],
    Yemen: ['Typica', 'Heirloom', 'Gesha'],
    Indonesia: ['Typica', 'Caturra', 'Catimor', 'Timor Hybrid', 'Ateng'],
    'El Salvador': ['Bourbon', 'Pacamara', 'Gesha', 'Caturra'],
    Nicaragua: ['Caturra', 'Bourbon', 'Catuaí', 'Maracaturra', 'Gesha'],
    Tanzania: ['Bourbon', 'Kent', 'N39', 'Gesha'],
};

export const buildAutoName = (origin: string, region: string, farm = '', variety = '') => {
    let name = origin;
    if (region) name += ` · ${region}`;
    if (farm) name += ` · ${farm}`;
    if (variety) name += ` · ${variety}`;
    return name;
};
