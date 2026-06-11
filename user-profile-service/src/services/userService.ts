import { UserRepository } from '../repositories/userRepository';

export class UserService {
    private repo: UserRepository;

    constructor() {
        this.repo = new UserRepository();
    }

    async createUser(userId: string, displayName: string, email: string) {
        // Saga Event Payload'unu hazırla
        const sagaEvent = {
            eventType: 'UserCreated',
            userId: userId,
            displayName: displayName,
            timestamp: new Date().toISOString()
        };

        // Repository'ye "Bu verileri güvenle (Transaction ile) kaydet" emri ver
        return await this.repo.createUserWithOutbox(userId, displayName, email, sagaEvent);
    }

    async deleteUser(userId: string) {
        // Saga Compensating Event (Telafi İşlemi) Payload'u
        const sagaEvent = {
            eventType: 'UserDeleted',
            userId: userId,
            timestamp: new Date().toISOString()
        };

        return await this.repo.deleteUserWithOutbox(userId, sagaEvent);
    }

    async getUser(userId: string) {
        return await this.repo.getUserById(userId);
    }

    async updateUser(userId: string, displayName: string) {
        return await this.repo.updateUser(userId, displayName);
    }
}