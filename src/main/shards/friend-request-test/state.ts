import {
  type FriendRequestTestSnapshot,
  createFriendRequestTestSnapshot
} from '@shared/shards/friend-request-test'
import { makeAutoObservable, observableRef } from 'mobx'

export class FriendRequestTestState {
  snapshot = createFriendRequestTestSnapshot()

  constructor() {
    makeAutoObservable(this, { snapshot: observableRef })
  }

  setSnapshot(snapshot: FriendRequestTestSnapshot) {
    this.snapshot = snapshot
  }

  update(update: Partial<FriendRequestTestSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update }
  }
}
