import { NextResponse } from "next/server";

function forbidden() {
  return NextResponse.json({ error: "Registration is disabled" }, { status: 403 });
}

export function GET() {
  return forbidden();
}

export function POST() {
  return forbidden();
}

export function PUT() {
  return forbidden();
}

export function PATCH() {
  return forbidden();
}

export function DELETE() {
  return forbidden();
}

export function HEAD() {
  return forbidden();
}

export function OPTIONS() {
  return forbidden();
}
