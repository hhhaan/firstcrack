import { useUpdateProfile } from '@entities/profile';
import { locationStore, parseLocationString } from '@shared/lib/locationStore';
import { weatherKeys } from '@shared/lib/query-keys';
import { useQueryClient } from '@tanstack/react-query';

export const useSaveAccountProfile = (userId: string) => {
    const qc = useQueryClient();
    const updateProfile = useUpdateProfile(userId);

    const save = async (input: {
        display_name: string;
        business_name: string | null;
        business_registration_number: string | null;
        location: string;
    }) => {
        const coords = parseLocationString(input.location);
        await Promise.all([
            updateProfile.mutateAsync({
                display_name: input.display_name,
                business_name: input.business_name,
                business_registration_number: input.business_registration_number,
            }),
            coords ? locationStore.set(coords) : Promise.resolve(),
        ]);
        if (coords) void qc.invalidateQueries({ queryKey: weatherKeys.coords });
    };

    return { save, isPending: updateProfile.isPending };
};
