export interface Invite {
    users: string[]
    createdAt: Date
}

export interface UserProfile {
    id: string, 
    name: {
        first: string,
        last: string
    },
    avatar: string
}

export interface UserDocument {
    id: string, 
    profile?: UserProfile,
    tokens?: string[]
}