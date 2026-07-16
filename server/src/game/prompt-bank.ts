import type { DrawingPrompt } from "./game-types.js";

export const DRAWING_PROMPTS = [
  {
    id: "octopus-elegance",
    statement:
      "Représente une pieuvre de la plus élégante (10) à la moins élégante (1).",
    lowLabel: "Moins élégante",
    highLabel: "Plus élégante",
    category: "élégance",
  },
  {
    id: "cabin-comfort",
    statement:
      "Représente une cabane de la plus confortable (10) à la moins confortable (1).",
    lowLabel: "Moins confortable",
    highLabel: "Plus confortable",
    category: "confort",
  },
  {
    id: "dragon-power",
    statement:
      "Représente un dragon du plus puissant (10) au moins puissant (1).",
    lowLabel: "Moins puissant",
    highLabel: "Plus puissant",
    category: "puissance",
  },
  {
    id: "penguin-suspicion",
    statement:
      "Représente un pingouin du plus suspect (10) au moins suspect (1).",
    lowLabel: "Moins suspect",
    highLabel: "Plus suspect",
    category: "suspicion",
  },
  {
    id: "train-speed",
    statement:
      "Représente un train du plus rapide (10) au moins rapide (1).",
    lowLabel: "Moins rapide",
    highLabel: "Plus rapide",
    category: "vitesse",
  },
  {
    id: "sandwich-appetite",
    statement:
      "Représente un sandwich du plus appétissant (10) au moins appétissant (1).",
    lowLabel: "Moins appétissant",
    highLabel: "Plus appétissant",
    category: "appétit",
  },
  {
    id: "lamp-modernity",
    statement:
      "Représente une lampe de la plus moderne (10) à la moins moderne (1).",
    lowLabel: "Moins moderne",
    highLabel: "Plus moderne",
    category: "modernité",
  },
  {
    id: "witch-kindness",
    statement:
      "Représente une sorcière de la plus gentille (10) à la moins gentille (1).",
    lowLabel: "Moins gentille",
    highLabel: "Plus gentille",
    category: "gentillesse",
  },
  {
    id: "island-danger",
    statement:
      "Représente une île de la plus dangereuse (10) à la moins dangereuse (1).",
    lowLabel: "Moins dangereuse",
    highLabel: "Plus dangereuse",
    category: "danger",
  },
  {
    id: "slipper-luxury",
    statement:
      "Représente une pantoufle de la plus luxueuse (10) à la moins luxueuse (1).",
    lowLabel: "Moins luxueuse",
    highLabel: "Plus luxueuse",
    category: "luxe",
  },
  {
    id: "alien-strangeness",
    statement:
      "Représente un extraterrestre du plus étrange (10) au moins étrange (1).",
    lowLabel: "Moins étrange",
    highLabel: "Plus étrange",
    category: "étrangeté",
  },
  {
    id: "vampire-fear",
    statement:
      "Représente un vampire du plus effrayant (10) au moins effrayant (1).",
    lowLabel: "Moins effrayant",
    highLabel: "Plus effrayant",
    category: "peur",
  },
  {
    id: "duck-humour",
    statement:
      "Représente un canard du plus drôle (10) au moins drôle (1).",
    lowLabel: "Moins drôle",
    highLabel: "Plus drôle",
    category: "humour",
  },
  {
    id: "cloud-sadness",
    statement:
      "Représente un nuage du plus triste (10) au moins triste (1).",
    lowLabel: "Moins triste",
    highLabel: "Plus triste",
    category: "tristesse",
  },
  {
    id: "bicycle-intelligence",
    statement:
      "Représente un vélo du plus intelligent (10) au moins intelligent (1).",
    lowLabel: "Moins intelligent",
    highLabel: "Plus intelligent",
    category: "intelligence",
  },
  {
    id: "crown-elegance",
    statement:
      "Représente une couronne de la plus élégante (10) à la moins élégante (1).",
    lowLabel: "Moins élégante",
    highLabel: "Plus élégante",
    category: "élégance",
  },
  {
    id: "sofa-comfort",
    statement:
      "Représente un canapé du plus confortable (10) au moins confortable (1).",
    lowLabel: "Moins confortable",
    highLabel: "Plus confortable",
    category: "confort",
  },
  {
    id: "hamster-power",
    statement:
      "Représente un hamster du plus puissant (10) au moins puissant (1).",
    lowLabel: "Moins puissant",
    highLabel: "Plus puissant",
    category: "puissance",
  },
  {
    id: "detective-suspicion",
    statement:
      "Représente un détective du plus suspect (10) au moins suspect (1).",
    lowLabel: "Moins suspect",
    highLabel: "Plus suspect",
    category: "suspicion",
  },
  {
    id: "rocket-speed",
    statement:
      "Représente une fusée de la plus rapide (10) à la moins rapide (1).",
    lowLabel: "Moins rapide",
    highLabel: "Plus rapide",
    category: "vitesse",
  },
  {
    id: "soup-appetite",
    statement:
      "Représente une soupe de la plus appétissante (10) à la moins appétissante (1).",
    lowLabel: "Moins appétissante",
    highLabel: "Plus appétissante",
    category: "appétit",
  },
  {
    id: "school-modernity",
    statement:
      "Représente une école de la plus moderne (10) à la moins moderne (1).",
    lowLabel: "Moins moderne",
    highLabel: "Plus moderne",
    category: "modernité",
  },
  {
    id: "goblin-cuteness",
    statement:
      "Représente un gobelin du plus mignon (10) au moins mignon (1).",
    lowLabel: "Moins mignon",
    highLabel: "Plus mignon",
    category: "mignonnerie",
  },
  {
    id: "bridge-danger",
    statement:
      "Représente un pont du plus dangereux (10) au moins dangereux (1).",
    lowLabel: "Moins dangereux",
    highLabel: "Plus dangereux",
    category: "danger",
  },
  {
    id: "tent-luxury",
    statement:
      "Représente une tente de la plus luxueuse (10) à la moins luxueuse (1).",
    lowLabel: "Moins luxueuse",
    highLabel: "Plus luxueuse",
    category: "luxe",
  },
  {
    id: "fish-strangeness",
    statement:
      "Représente un poisson du plus étrange (10) au moins étrange (1).",
    lowLabel: "Moins étrange",
    highLabel: "Plus étrange",
    category: "étrangeté",
  },
  {
    id: "scarecrow-fear",
    statement:
      "Représente un épouvantail du plus effrayant (10) au moins effrayant (1).",
    lowLabel: "Moins effrayant",
    highLabel: "Plus effrayant",
    category: "peur",
  },
  {
    id: "king-humour",
    statement:
      "Représente un roi du plus drôle (10) au moins drôle (1).",
    lowLabel: "Moins drôle",
    highLabel: "Plus drôle",
    category: "humour",
  },
  {
    id: "sun-sadness",
    statement:
      "Représente un soleil du plus triste (10) au moins triste (1).",
    lowLabel: "Moins triste",
    highLabel: "Plus triste",
    category: "tristesse",
  },
  {
    id: "backpack-intelligence",
    statement:
      "Représente un sac à dos du plus intelligent (10) au moins intelligent (1).",
    lowLabel: "Moins intelligent",
    highLabel: "Plus intelligent",
    category: "intelligence",
  },
  {
    id: "whale-elegance",
    statement:
      "Représente une baleine de la plus élégante (10) à la moins élégante (1).",
    lowLabel: "Moins élégante",
    highLabel: "Plus élégante",
    category: "élégance",
  },
  {
    id: "spaceship-comfort",
    statement:
      "Représente un vaisseau spatial du plus confortable (10) au moins confortable (1).",
    lowLabel: "Moins confortable",
    highLabel: "Plus confortable",
    category: "confort",
  },
  {
    id: "fairy-power",
    statement:
      "Représente une fée de la plus puissante (10) à la moins puissante (1).",
    lowLabel: "Moins puissante",
    highLabel: "Plus puissante",
    category: "puissance",
  },
  {
    id: "neighbor-suspicion",
    statement:
      "Représente un voisin du plus suspect (10) au moins suspect (1).",
    lowLabel: "Moins suspect",
    highLabel: "Plus suspect",
    category: "suspicion",
  },
  {
    id: "snail-speed",
    statement:
      "Représente un escargot du plus rapide (10) au moins rapide (1).",
    lowLabel: "Moins rapide",
    highLabel: "Plus rapide",
    category: "vitesse",
  },
  {
    id: "planet-appetite",
    statement:
      "Représente une planète de la plus appétissante (10) à la moins appétissante (1).",
    lowLabel: "Moins appétissante",
    highLabel: "Plus appétissante",
    category: "appétit",
  },
] as const satisfies readonly DrawingPrompt[];
