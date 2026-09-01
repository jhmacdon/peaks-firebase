import type { KeeperSourceMember } from "./core";

export interface KeeperProductionManifest {
  generatedAt: string;
  sourcesSha256: string;
  selection: string;
  rosterSha256: string;
}

export interface KeeperSourceDescriptor {
  fixtureSource: string;
  keeperRosterSource: string;
  assertMemberIdentity(sourceKey: string, member: KeeperSourceMember): void;
}

export const DOBIH_V18_5_SOURCE: KeeperSourceDescriptor = {
  fixtureSource: "dobih-v18.5",
  keeperRosterSource: "dobih-v18.5",
  assertMemberIdentity(_sourceKey, member) {
    if (!Number.isInteger(member.dobihNumber) ||
        member.sourceMemberId !== `dobih:${member.dobihNumber}`) {
      throw new Error(
        `DoBIH keeper member ${member.sourceMemberId} has a Number that does not match ` +
        "its source member ID"
      );
    }
  },
};

export const UIAA_BULLETIN_152_SOURCE: KeeperSourceDescriptor = {
  fixtureSource: "uiaa-pyrenees-main",
  keeperRosterSource: "uiaa-bulletin-152",
  assertMemberIdentity(_sourceKey, member) {
    const expectedSourceMemberId =
      `uiaa-pyrenees-main:${String(member.ordinal).padStart(3, "0")}`;
    if (member.buyseMainNumber !== member.ordinal ||
        member.sourceMemberId !== expectedSourceMemberId) {
      throw new Error(
        `UIAA keeper member ${member.sourceMemberId} must match ordinal ` +
        `${member.ordinal}, Buyse main number, and padded source member ID ` +
        expectedSourceMemberId
      );
    }
  },
};
