// The object a commission composes (operator, 2026-10-21: "i was returning to the commodity form of the entity as what
// conceals the operator or in which the operator comes to speak with the voice of the entity, and simply expanding my
// vocabualry beyond entity").
//
// Two kinds. An *entity* is what /non has always composed: a thing with a name, read across the field and the archive.
// An *operator* is the operation the entity form conceals (EA-WIKI-OPEN-01 §1): an act (a count over a domain ending in
// a total negation; a mantle conferred; an attribution transferred) that the encyclopedic sentence states as an
// attribute of an entity. Composed as its own object, the operator is the subject: what it does, on what, where it is
// performed, which entities speak with its voice (each attributization as an instance), and where it stops. Its strings
// are the phrases in which it is performed and the phrases in which entities speak it.
//
// Every S7 pass is written for an entity. For an operator, a preamble states how the pass reads its object; the pass's
// own rules stand unchanged.
export const OBJECT_KINDS = ["entity", "operator"];

export const OPERATOR_PREAMBLE = `THE OBJECT OF THIS PASS IS AN OPERATOR. An operator is an operation: an act a text performs (a count, a negation, a transfer, a conferral, a measure, a construction), considered apart from the entities that carry it. In an encyclopedic sentence the operation is often stated as an attribute of an entity ("the first work", "the founder of"), and the operator then speaks with the entity's voice. Wherever the instructions below say "the entity", the pass reads "the operator". A passage bears on the operator where it performs the operation, names or describes it, states its domain, inputs, outputs or limits, or states what the operation does as an attribute of an entity; that last is an instance of the operator speaking with an entity's voice, and the pass records the entity it speaks through. A passage that only names an entity the operator speaks through, and says nothing of the operation, does not bear.

`;

export const kindOf = (input) => (input?.object_kind === "operator" ? "operator" : "entity");
export const forKind = (instructions, input) => (kindOf(input) === "operator" ? OPERATOR_PREAMBLE + instructions : instructions);
