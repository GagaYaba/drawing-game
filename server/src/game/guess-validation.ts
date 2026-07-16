import type { GuessValue, SubmitGuessPayload } from "@drawing-game/shared";

type GuessPayloadValidationResult =
  | {
      success: true;
      data: {
        value: GuessValue;
      };
    }
  | {
      success: false;
      error: {
        code: "INVALID_GUESS";
        message: string;
      };
    };

const INVALID_GUESS_MESSAGE =
  "L’estimation doit être un nombre entier compris entre 1 et 10.";

function invalidGuess(): GuessPayloadValidationResult {
  return {
    success: false,
    error: {
      code: "INVALID_GUESS",
      message: INVALID_GUESS_MESSAGE,
    },
  };
}

export function validateSubmitGuessPayload(
  payload: unknown,
): GuessPayloadValidationResult {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return invalidGuess();
  }

  try {
    const prototype = Object.getPrototypeOf(payload);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidGuess();
    }

    const keys = Reflect.ownKeys(payload);
    if (keys.length !== 1 || keys[0] !== "value") {
      return invalidGuess();
    }

    const descriptor = Object.getOwnPropertyDescriptor(payload, "value");
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "number" ||
      !Number.isFinite(descriptor.value) ||
      !Number.isInteger(descriptor.value) ||
      descriptor.value < 1 ||
      descriptor.value > 10
    ) {
      return invalidGuess();
    }

    const validatedPayload: SubmitGuessPayload = {
      value: descriptor.value,
    };

    return {
      success: true,
      data: {
        value: validatedPayload.value as GuessValue,
      },
    };
  } catch {
    return invalidGuess();
  }
}
