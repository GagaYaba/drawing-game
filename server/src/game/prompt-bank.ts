import type { DrawingPrompt } from "./game-types.js";

export const DRAWING_PROMPTS = [
  {
    id: "octopus-elegance",
    statement:
      "Représente une pieuvre de la moins élégante à la plus élégante.",
    lowLabel: "Moins élégante",
    highLabel: "Plus élégante",
    category: "élégance",
  },
  {
    id: "cabin-comfort",
    statement:
      "Représente une cabane de la moins confortable à la plus confortable.",
    lowLabel: "Moins confortable",
    highLabel: "Plus confortable",
    category: "confort",
  },
  {
    id: "dragon-power",
    statement:
      "Représente un dragon du moins puissant au plus puissant.",
    lowLabel: "Moins puissant",
    highLabel: "Plus puissant",
    category: "puissance",
  },
  {
    id: "penguin-suspicion",
    statement:
      "Représente un pingouin du moins suspect au plus suspect.",
    lowLabel: "Moins suspect",
    highLabel: "Plus suspect",
    category: "suspicion",
  },
  {
    id: "train-speed",
    statement:
      "Représente un train du moins rapide au plus rapide.",
    lowLabel: "Moins rapide",
    highLabel: "Plus rapide",
    category: "vitesse",
  },
  {
    id: "sandwich-appetite",
    statement:
      "Représente un sandwich du moins appétissant au plus appétissant.",
    lowLabel: "Moins appétissant",
    highLabel: "Plus appétissant",
    category: "appétit",
  },
  {
    id: "lamp-modernity",
    statement:
      "Représente une lampe de la moins moderne à la plus moderne.",
    lowLabel: "Moins moderne",
    highLabel: "Plus moderne",
    category: "modernité",
  },
  {
    id: "witch-kindness",
    statement:
      "Représente une sorcière de la moins gentille à la plus gentille.",
    lowLabel: "Moins gentille",
    highLabel: "Plus gentille",
    category: "gentillesse",
  },
  {
    id: "island-danger",
    statement:
      "Représente une île de la moins dangereuse à la plus dangereuse.",
    lowLabel: "Moins dangereuse",
    highLabel: "Plus dangereuse",
    category: "danger",
  },
  {
    id: "slipper-luxury",
    statement:
      "Représente une pantoufle de la moins luxueuse à la plus luxueuse.",
    lowLabel: "Moins luxueuse",
    highLabel: "Plus luxueuse",
    category: "luxe",
  },
  {
    id: "alien-strangeness",
    statement:
      "Représente un extraterrestre du moins étrange au plus étrange.",
    lowLabel: "Moins étrange",
    highLabel: "Plus étrange",
    category: "étrangeté",
  },
  {
    id: "vampire-fear",
    statement:
      "Représente un vampire du moins effrayant au plus effrayant.",
    lowLabel: "Moins effrayant",
    highLabel: "Plus effrayant",
    category: "peur",
  },
  {
    id: "duck-humour",
    statement:
      "Représente un canard du moins drôle au plus drôle.",
    lowLabel: "Moins drôle",
    highLabel: "Plus drôle",
    category: "humour",
  },
  {
    id: "cloud-sadness",
    statement:
      "Représente un nuage du moins triste au plus triste.",
    lowLabel: "Moins triste",
    highLabel: "Plus triste",
    category: "tristesse",
  },
  {
    id: "bicycle-intelligence",
    statement:
      "Représente un vélo du moins intelligent au plus intelligent.",
    lowLabel: "Moins intelligent",
    highLabel: "Plus intelligent",
    category: "intelligence",
  },
  {
    id: "crown-elegance",
    statement:
      "Représente une couronne de la moins élégante à la plus élégante.",
    lowLabel: "Moins élégante",
    highLabel: "Plus élégante",
    category: "élégance",
  },
  {
    id: "sofa-comfort",
    statement:
      "Représente un canapé du moins confortable au plus confortable.",
    lowLabel: "Moins confortable",
    highLabel: "Plus confortable",
    category: "confort",
  },
  {
    id: "hamster-power",
    statement:
      "Représente un hamster du moins puissant au plus puissant.",
    lowLabel: "Moins puissant",
    highLabel: "Plus puissant",
    category: "puissance",
  },
  {
    id: "detective-suspicion",
    statement:
      "Représente un détective du moins suspect au plus suspect.",
    lowLabel: "Moins suspect",
    highLabel: "Plus suspect",
    category: "suspicion",
  },
  {
    id: "rocket-speed",
    statement:
      "Représente une fusée de la moins rapide à la plus rapide.",
    lowLabel: "Moins rapide",
    highLabel: "Plus rapide",
    category: "vitesse",
  },
  {
    id: "soup-appetite",
    statement:
      "Représente une soupe de la moins appétissante à la plus appétissante.",
    lowLabel: "Moins appétissante",
    highLabel: "Plus appétissante",
    category: "appétit",
  },
  {
    id: "school-modernity",
    statement:
      "Représente une école de la moins moderne à la plus moderne.",
    lowLabel: "Moins moderne",
    highLabel: "Plus moderne",
    category: "modernité",
  },
  {
    id: "goblin-cuteness",
    statement:
      "Représente un gobelin du moins mignon au plus mignon.",
    lowLabel: "Moins mignon",
    highLabel: "Plus mignon",
    category: "mignonnerie",
  },
  {
    id: "bridge-danger",
    statement:
      "Représente un pont du moins dangereux au plus dangereux.",
    lowLabel: "Moins dangereux",
    highLabel: "Plus dangereux",
    category: "danger",
  },
  {
    id: "tent-luxury",
    statement:
      "Représente une tente de la moins luxueuse à la plus luxueuse.",
    lowLabel: "Moins luxueuse",
    highLabel: "Plus luxueuse",
    category: "luxe",
  },
  {
    id: "fish-strangeness",
    statement:
      "Représente un poisson du moins étrange au plus étrange.",
    lowLabel: "Moins étrange",
    highLabel: "Plus étrange",
    category: "étrangeté",
  },
  {
    id: "scarecrow-fear",
    statement:
      "Représente un épouvantail du moins effrayant au plus effrayant.",
    lowLabel: "Moins effrayant",
    highLabel: "Plus effrayant",
    category: "peur",
  },
  {
    id: "king-humour",
    statement:
      "Représente un roi du moins drôle au plus drôle.",
    lowLabel: "Moins drôle",
    highLabel: "Plus drôle",
    category: "humour",
  },
  {
    id: "sun-sadness",
    statement:
      "Représente un soleil du moins triste au plus triste.",
    lowLabel: "Moins triste",
    highLabel: "Plus triste",
    category: "tristesse",
  },
  {
    id: "backpack-intelligence",
    statement:
      "Représente un sac à dos du moins intelligent au plus intelligent.",
    lowLabel: "Moins intelligent",
    highLabel: "Plus intelligent",
    category: "intelligence",
  },
  {
    id: "whale-elegance",
    statement:
      "Représente une baleine de la moins élégante à la plus élégante.",
    lowLabel: "Moins élégante",
    highLabel: "Plus élégante",
    category: "élégance",
  },
  {
    id: "spaceship-comfort",
    statement:
      "Représente un vaisseau spatial du moins confortable au plus confortable.",
    lowLabel: "Moins confortable",
    highLabel: "Plus confortable",
    category: "confort",
  },
  {
    id: "fairy-power",
    statement:
      "Représente une fée de la moins puissante à la plus puissante.",
    lowLabel: "Moins puissante",
    highLabel: "Plus puissante",
    category: "puissance",
  },
  {
    id: "neighbor-suspicion",
    statement:
      "Représente un voisin du moins suspect au plus suspect.",
    lowLabel: "Moins suspect",
    highLabel: "Plus suspect",
    category: "suspicion",
  },
  {
    id: "snail-speed",
    statement:
      "Représente un escargot du moins rapide au plus rapide.",
    lowLabel: "Moins rapide",
    highLabel: "Plus rapide",
    category: "vitesse",
  },
  {
    id: "planet-appetite",
    statement:
      "Représente une planète de la moins appétissante à la plus appétissante.",
    lowLabel: "Moins appétissante",
    highLabel: "Plus appétissante",
    category: "appétit",
  },
] as const satisfies readonly DrawingPrompt[];
