import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  isPublicMotorized,
  MAINT_LEVEL_NUMBER,
  parseMaintenanceLevel,
  parseSurfaceType,
  SURFACE_RANK,
  VEHICLE_RANK,
  vehicleRequirementFromBlmClass,
  vehicleRequirementFromMaintenanceLevel,
} from "../roads/road-enums";

test("maintenance levels parse from the RoadCore label form", () => {
  assert.equal(parseMaintenanceLevel("2 - HIGH CLEARANCE VEHICLES"), "ml2");
  assert.equal(parseMaintenanceLevel("3 - SUITABLE FOR PASSENGER CARS"), "ml3");
  assert.equal(parseMaintenanceLevel("1 - BASIC CUSTODIAL CARE (CLOSED)"), "ml1");
  assert.equal(parseMaintenanceLevel("0 - NOT MAINTAINED"), "ml0");
  assert.equal(parseMaintenanceLevel("NA - NOT APPLICABLE"), "na");
});

test("maintenance levels parse from the bare and truncated MVUM forms", () => {
  assert.equal(parseMaintenanceLevel("2"), "ml2");
  assert.equal(parseMaintenanceLevel("2 - "), "ml2");
  assert.equal(parseMaintenanceLevel(" 5 - HIGH DEGREE OF USER COMFORT "), "ml5");
});

test("a blank or unknown maintenance level is null, not a guess", () => {
  assert.equal(parseMaintenanceLevel(null), null);
  assert.equal(parseMaintenanceLevel(""), null);
  assert.equal(parseMaintenanceLevel(" "), null);
  assert.equal(parseMaintenanceLevel("9 - SOMETHING NEW"), null);
});

test("only `na` has no number", () => {
  assert.equal(MAINT_LEVEL_NUMBER.ml2, 2);
  assert.equal(MAINT_LEVEL_NUMBER.ml5, 5);
  assert.equal(MAINT_LEVEL_NUMBER.na, null);
});

test("surface types parse by code, across both label spellings", () => {
  assert.equal(parseSurfaceType("NAT - NATIVE MATERIAL"), "native");
  assert.equal(parseSurfaceType("AGG - CRUSHED AGGREGATE OR GRAVEL"), "aggregate");
  assert.equal(parseSurfaceType("AGG - SCORIA"), "aggregate");
  assert.equal(parseSurfaceType("AGG - LIMESTONE"), "aggregate");
  assert.equal(parseSurfaceType("IMP - IMPROVED NATIVE MATERIAL"), "improved_native");
  assert.equal(parseSurfaceType("AC - ASPHALT"), "asphalt");
  assert.equal(parseSurfaceType("P - PAVED"), "asphalt");
  assert.equal(parseSurfaceType("PCC - PORTLAND CEMENT CONCRETE"), "asphalt");
  assert.equal(parseSurfaceType("BST - BITUMINOUS SURFACE TREATMENT"), "bituminous");
  assert.equal(parseSurfaceType("PIT - PIT RUN SHOT ROCK"), "native");
  assert.equal(parseSurfaceType("SOD - GRASS"), "native");
  assert.equal(parseSurfaceType("OTHER - OTHER"), "other");
  assert.equal(parseSurfaceType(" "), null);
  assert.equal(parseSurfaceType(null), null);
});

test("surfaces rank from smoothest to roughest, and `other` cannot be ranked", () => {
  assert.ok(SURFACE_RANK.asphalt! < SURFACE_RANK.aggregate!);
  assert.ok(SURFACE_RANK.aggregate! < SURFACE_RANK.improved_native!);
  assert.ok(SURFACE_RANK.improved_native! < SURFACE_RANK.native!);
  assert.equal(SURFACE_RANK.other, null);
});

test("levels 3, 4 and 5 are all passenger car; level 2 is the high-clearance line", () => {
  assert.equal(vehicleRequirementFromMaintenanceLevel("ml5"), "passenger_car");
  assert.equal(vehicleRequirementFromMaintenanceLevel("ml4"), "passenger_car");
  assert.equal(vehicleRequirementFromMaintenanceLevel("ml3"), "passenger_car");
  assert.equal(vehicleRequirementFromMaintenanceLevel("ml2"), "high_clearance");
  assert.equal(vehicleRequirementFromMaintenanceLevel("ml1"), "not_maintained");
  assert.equal(vehicleRequirementFromMaintenanceLevel("ml0"), "not_maintained");
  assert.equal(vehicleRequirementFromMaintenanceLevel("na"), null);
  assert.equal(vehicleRequirementFromMaintenanceLevel(null), null);
});

test("the BLM observed class reads the same way", () => {
  assert.equal(vehicleRequirementFromBlmClass("2wd"), "passenger_car");
  assert.equal(vehicleRequirementFromBlmClass("4wd"), "four_wheel_drive");
  assert.equal(
    vehicleRequirementFromBlmClass("4wd_high_clearance"),
    "four_wheel_drive_high_clearance",
  );
  assert.equal(vehicleRequirementFromBlmClass("atv"), "atv_only");
  assert.equal(vehicleRequirementFromBlmClass("unknown"), null);
  assert.equal(vehicleRequirementFromBlmClass(null), null);
});

test("vehicle ranks order by how much they demand of the vehicle", () => {
  assert.ok(VEHICLE_RANK.passenger_car < VEHICLE_RANK.high_clearance);
  assert.ok(VEHICLE_RANK.high_clearance < VEHICLE_RANK.four_wheel_drive);
  assert.ok(VEHICLE_RANK.four_wheel_drive < VEHICLE_RANK.four_wheel_drive_high_clearance);
  assert.ok(VEHICLE_RANK.four_wheel_drive_high_clearance < VEHICLE_RANK.atv_only);
  assert.ok(VEHICLE_RANK.atv_only < VEHICLE_RANK.not_maintained);
});

test("the RoadCore open layer is ALL or PUBLIC, with a level that is not 1", () => {
  assert.equal(isPublicMotorized("ALL", "2 - HIGH CLEARANCE VEHICLES"), true);
  assert.equal(isPublicMotorized("PUBLIC", "2 - HIGH CLEARANCE VEHICLES"), true);
  assert.equal(isPublicMotorized("ALL", "0 - NOT MAINTAINED"), true);
  assert.equal(isPublicMotorized("ALL", "NA - NOT APPLICABLE"), true);
  assert.equal(isPublicMotorized("ALL", "1 - BASIC CUSTODIAL CARE (CLOSED)"), false);
  assert.equal(isPublicMotorized("ADMIN", "2 - HIGH CLEARANCE VEHICLES"), false);
  assert.equal(isPublicMotorized(null, "2 - HIGH CLEARANCE VEHICLES"), false);
  // A row with no maintenance level is not in the published open layer.
  assert.equal(isPublicMotorized("ALL", null), false);
  assert.equal(isPublicMotorized("ALL", " "), false);
});
