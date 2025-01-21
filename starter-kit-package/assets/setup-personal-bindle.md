# Setup Personal Team Bindle for Sandbox Accounts

When creating sandbox test accounts under your Alias, it is required that you use a personal team bindle. This document will provide guidance on the creation of a personal team bindle. If you already have one in place, you may skip this section. This is essentially the creation of a 2 person team, you and your manager.

## Create a CTI and Resolver

1. Navigate to [CTI self-service](https://cti.amazon.com/)
2. Click on `Create a new Resolver Group` on the right of page.
3. In the form, provide the following and click `Save`:
    - Group Name: ALIAS-personal
    - Manager Login: Manager ALIAS
    - City: YOUR CITY
    - Leave the rest as default
4. Click on `Create a new CTI` towards the bottom right of page.
5. In the form, provide the following:
    - New Category: No
    - Category: AWS
    - New Type: No
    - Type: Personal
    - Item: YOUR ALIAS
6. Click on `Assign a Resolver Group to a CTI` on the right of page.
7. Select the Resolver Group you just created in step 3 above.
8. Enter Support Order: 1
9. Click `Save`

With the CIT created, you can now create a new Team.

## Create a Team

1. Recommend using Firefox for the Teams page as there appears to be observed issues with Chrome.
2. Navigate to [Teams](https://permissions.amazon.com/a/team/) to create a team.
3. Fill out form with the following information:
    - Name: ALIAS-team
    - Description: Provide a description of your team
    - Secondary Owner: Manager ALIAS
    - For CTI, fill in the CTI you created above AWS -> Personal -> ALIAS -> ALIAS-personal
    - Enter your ALIAS under Email
4. Click on `Preview New Team Membership`
5. Check the box to acknowledge and `Create Team`
6. Under `Associated POSIX/LDAP/ANT Groups`, click `Edit` to assign a POSIX Group.
7. If you are not the primary owner of one, you can create a new one. Just type in `ALIAS-team`, POSIX Group, and `Create and Add Group`
8. Once the Group is created and added, you need to add yourself as a Member. Click on the `Rule` tab under `Membership Policy`
9. Click the box `Edit` to edit the Rule filter
10. Check the box `Reports of` and type in your alias
11. Check the box `Include people listed above?`
12. Click the `Update rule` button below
13. You should see a preview that one member will be added, which is yourself. Click `Next`
14. Check the box to acknowledge and click `Update rule`

Note : Users are now required to have a non-empty posix group associated with bindle owning team. If you are seeing error that says "posix group doesnt exist" its likely because there are no people in posix group that you created

Note : Posix group that is added to team will be used as ownership group on your Isengard account later. It may take time before this change is propogated.

## Create a Personal Team Bindle

1. Navigate to [bindles.amazon.com](bindles.amazon.com) and click `Create Bindle` under `Team-owned`. We select this as opposed to `Personal Bindle` as it is required to have a Team-owned bindle for Isengard.
2. Complete the bindle creation form
    - Name: ALIAS-Team
    - Description:  ALIAS-Team bindle
    - Owning Team: Enter your new Team name you created earlier
    - CTI: Use Team CTI
3. Click on `Submit`

You now have a new personal team Bindle you can use for Isengard.
